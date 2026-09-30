#!/usr/bin/env python3
"""NextVision worker.

  analyze.py prepare IN OUT --poster P [--codec h264|vp9] [--max-seconds N]
      Probe the upload, enforce the length limit, write a web-playable preview and a poster frame.
  analyze.py analyze VIDEO --config cfg.json --out DIR
      Detect + track people and vehicles, evaluate zones / counting lines, write DIR/result.json and keyframes.

Stdout is JSON lines (progress / final meta) for the Node parent. Errors go to stderr with exit code 1.
Detector: YOLOX (Apache-2.0) through onnxruntime on CPU. Tracker and event logic are our own code.
"""
import argparse, json, math, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('NEXTVISION_MODEL', os.path.join(HERE, 'models', 'yolox_tiny.onnx'))
MODEL_NAME = os.path.basename(MODEL)
COCO = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
GROUP = {0: 'person', 1: 'vehicle', 2: 'vehicle', 3: 'vehicle', 5: 'vehicle', 7: 'vehicle'}
GCODE = {'person': 0, 'vehicle': 1}


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n'); sys.stdout.flush()


def fail(msg, code=1):
    sys.stderr.write(msg + '\n'); sys.exit(code)


# ------------------------------------------------------------------ prepare
def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'stream=width,height,avg_frame_rate,r_frame_rate,duration,nb_frames:format=duration',
                        '-of', 'json', path], capture_output=True, text=True)
    if r.returncode != 0: fail('เปิดไฟล์วิดีโอไม่ได้ (รูปแบบไฟล์ไม่รองรับหรือไฟล์เสียหาย)')
    j = json.loads(r.stdout or '{}'); s = (j.get('streams') or [{}])[0]
    if not s.get('width'): fail('ไม่พบภาพวิดีโอในไฟล์นี้')
    def rate(v):
        try:
            a, b = v.split('/'); return float(a) / float(b) if float(b) else 0
        except Exception: return 0
    fps = rate(s.get('avg_frame_rate', '')) or rate(s.get('r_frame_rate', '')) or 25.0
    dur = float(s.get('duration') or (j.get('format') or {}).get('duration') or 0)
    return {'width': int(s['width']), 'height': int(s['height']), 'fps': fps, 'duration': dur}


def cmd_prepare(a):
    import cv2
    m = probe(a.input)
    if m['duration'] <= 0: fail('อ่านความยาวคลิปไม่ได้')
    if m['duration'] > a.max_seconds: fail(f"คลิปยาว {m['duration']:.0f} วินาที เกินกำหนด {a.max_seconds} วินาที ตัดคลิปให้สั้นลงก่อนอัปโหลด")
    fps = min(m['fps'], 25.0)
    vf = f"scale='min({a.maxw},iw)':-2"
    if a.codec == 'vp9':
        enc = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1']
    else:
        enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', a.input, '-an', '-vf', vf, '-r', f'{fps:.3f}', *enc, a.output], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(a.output): fail('แปลงวิดีโอไม่สำเร็จ: ' + r.stderr[-300:])
    cap = cv2.VideoCapture(a.output)
    cap.set(cv2.CAP_PROP_POS_MSEC, min(1.0, m['duration'] / 2) * 1000)
    ok, fr = cap.read()
    if not ok:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0); ok, fr = cap.read()
    if not ok: fail('ดึงภาพตัวอย่างจากคลิปไม่ได้')
    cv2.imwrite(a.poster, fr, [cv2.IMWRITE_JPEG_QUALITY, 82])
    h, w = fr.shape[:2]
    out({'done': True, 'width': w, 'height': h, 'fps': round(fps, 2), 'duration': round(m['duration'], 2),
         'origWidth': m['width'], 'origHeight': m['height']})


# ------------------------------------------------------------------ detection
class Detector:
    def __init__(self, path, conf=0.25, nms=0.45, threads=2):
        import numpy as np, onnxruntime as ort
        self.np = np
        so = ort.SessionOptions(); so.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
        inp = self.sess.get_inputs()[0]; self.name = inp.name
        self.H, self.W = (inp.shape[2], inp.shape[3]) if all(isinstance(v, int) for v in inp.shape[2:]) else (416, 416)
        self.conf, self.nms = conf, nms
        grids, strides = [], []
        for st in (8, 16, 32):
            hs, ws = self.H // st, self.W // st
            xv, yv = np.meshgrid(np.arange(ws), np.arange(hs))
            g = np.stack((xv, yv), 2).reshape(-1, 2); grids.append(g); strides.append(np.full((g.shape[0], 1), st))
        self.grids = np.concatenate(grids, 0).astype(np.float32); self.strides = np.concatenate(strides, 0).astype(np.float32)

    def __call__(self, img):
        import cv2
        np = self.np
        h, w = img.shape[:2]; r = min(self.H / h, self.W / w)
        rs = cv2.resize(img, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR)
        pad = np.full((self.H, self.W, 3), 114, np.uint8); pad[:rs.shape[0], :rs.shape[1]] = rs
        x = pad.transpose(2, 0, 1)[None].astype(np.float32)
        o = self.sess.run(None, {self.name: x})[0][0]
        o[:, :2] = (o[:, :2] + self.grids) * self.strides
        o[:, 2:4] = np.exp(o[:, 2:4]) * self.strides
        sc_all = o[:, 4:5] * o[:, 5:]
        cls = sc_all.argmax(1); sc = sc_all[np.arange(len(cls)), cls]
        m = np.isin(cls, list(COCO)) & (sc >= self.conf)
        o, cls, sc = o[m], cls[m], sc[m]
        if not len(sc): return []
        cx, cy, bw, bh = o[:, 0] / r, o[:, 1] / r, o[:, 2] / r, o[:, 3] / r
        res = []
        for g in ('person', 'vehicle'):
            idx = np.array([i for i, c in enumerate(cls) if GROUP[int(c)] == g], dtype=int)
            if not len(idx): continue
            boxes = [[float(cx[i] - bw[i] / 2), float(cy[i] - bh[i] / 2), float(bw[i]), float(bh[i])] for i in idx]
            keep = cv2.dnn.NMSBoxes(boxes, [float(sc[i]) for i in idx], self.conf, self.nms)
            for k in np.array(keep).flatten():
                i = idx[int(k)]; x0, y0, ww, hh = boxes[int(k)]
                x0, y0 = max(0.0, x0), max(0.0, y0); x1, y1 = min(w - 1.0, x0 + ww), min(h - 1.0, y0 + hh)
                if x1 - x0 < 4 or y1 - y0 < 4: continue
                res.append({'box': [x0, y0, x1, y1], 'group': g, 'cls': COCO[int(cls[i])], 'conf': float(sc[i])})
        return res


# ------------------------------------------------------------------ tracker (IoU + constant velocity, two-stage association)
def iou(a, b):
    ix0, iy0, ix1, iy1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0); inter = iw * ih
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


class Track:
    _n = 0
    def __init__(self, d, t):
        Track._n += 1; self.id = Track._n; self.group = d['group']; self.cls = d['cls']; self.box = list(d['box']); self.vel = [0.0, 0.0]
        self.hits = 1; self.miss = 0; self.conf = d['conf']; self.first = t; self.last = t; self.n = 1; self.cls_votes = {d['cls']: 1}
    def predicted(self):
        return [self.box[0] + self.vel[0], self.box[1] + self.vel[1], self.box[2] + self.vel[0], self.box[3] + self.vel[1]]
    def update(self, d, t):
        ocx, ocy = (self.box[0] + self.box[2]) / 2, (self.box[1] + self.box[3]) / 2
        ncx, ncy = (d['box'][0] + d['box'][2]) / 2, (d['box'][1] + d['box'][3]) / 2
        self.vel = [0.6 * self.vel[0] + 0.4 * (ncx - ocx), 0.6 * self.vel[1] + 0.4 * (ncy - ocy)]
        self.box = list(d['box']); self.hits += 1; self.miss = 0; self.conf = d['conf']; self.last = t; self.n += 1
        self.cls_votes[d['cls']] = self.cls_votes.get(d['cls'], 0) + 1
        self.cls = max(self.cls_votes, key=self.cls_votes.get)


class Tracker:
    def __init__(self, max_miss=6, min_hits=3, hi=0.45, iou_hi=0.25, iou_lo=0.2):
        self.tracks = []; self.max_miss, self.min_hits, self.hi, self.iou_hi, self.iou_lo = max_miss, min_hits, hi, iou_hi, iou_lo
        Track._n = 0

    def _match(self, tracks, dets, thr):
        pairs = []
        for ti, tr in enumerate(tracks):
            p = tr.predicted()
            for di, d in enumerate(dets):
                if d['group'] != tr.group: continue
                v = iou(p, d['box'])
                if v >= thr: pairs.append((v, ti, di))
        pairs.sort(reverse=True); ut, ud, res = set(), set(), []
        for v, ti, di in pairs:
            if ti in ut or di in ud: continue
            ut.add(ti); ud.add(di); res.append((ti, di))
        return res, [i for i in range(len(tracks)) if i not in ut], [i for i in range(len(dets)) if i not in ud]

    def update(self, dets, t):
        high = [d for d in dets if d['conf'] >= self.hi]; low = [d for d in dets if d['conf'] < self.hi]
        m1, ut, ud = self._match(self.tracks, high, self.iou_hi)
        for ti, di in m1: self.tracks[ti].update(high[di], t)
        rest = [self.tracks[i] for i in ut]
        m2, ut2, _ = self._match(rest, low, self.iou_lo)
        for ti, di in m2: rest[ti].update(low[di], t)
        for i in ut2:
            tr = rest[i]; tr.miss += 1
            tr.box = tr.predicted()
        for di in ud: self.tracks.append(Track(high[di], t))
        self.tracks = [tr for tr in self.tracks if tr.miss <= self.max_miss and not (tr.hits < self.min_hits and tr.miss > 1)]
        return [tr for tr in self.tracks if tr.miss == 0 and tr.hits >= self.min_hits]


# ------------------------------------------------------------------ geometry
def in_poly(pt, poly):
    x, y = pt; inside = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: inside = not inside
    return inside


def side_of(a, b, p):
    v = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)


def seg_u(a, b, p):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L if L else -1


# ------------------------------------------------------------------ analyze
def cmd_analyze(a):
    import cv2, numpy as np
    cfg = json.load(open(a.config)); os.makedirs(os.path.join(a.out, 'frames'), exist_ok=True)
    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened(): fail('เปิดไฟล์วิดีโอไม่ได้')
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0; total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sample_fps = float(cfg.get('sampleFps', 5)); step = max(1, int(round(fps / sample_fps))); dt = step / fps
    mods = cfg.get('modules') or {}
    zones = [z for z in (cfg.get('zones') or []) if len(z.get('points') or []) >= 3] if mods.get('zone', True) else []
    lines = [l for l in (cfg.get('lines') or []) if len(l.get('points') or []) == 2] if mods.get('line', True) else []
    crowd_n = int(cfg.get('crowdThreshold', 0)) if mods.get('crowd', True) else 0
    det = Detector(MODEL, conf=float(cfg.get('minConfidence', 0.30)), threads=int(os.environ.get('NEXTVISION_THREADS', '2')))
    trk = Tracker(max_miss=max(2, int(round(1.2 / dt))), min_hits=3)

    events, frames_out, counts = [], [], []
    zstate = {}     # (zone id, track id) -> dict(inside, since, out, fired)
    zstats = {z['id']: {'entries': 0, 'unique': set(), 'peak': 0, 'dwell': 0.0} for z in zones}
    lstate = {}     # (line id, track id) -> last side
    lcool = {}
    lstats = {l['id']: {'a2b': 0, 'b2a': 0} for l in lines}
    seen = {'person': set(), 'vehicle': set()}; tinfo = {}
    heat_w, heat_h = 32, 18; heat = np.zeros((heat_h, heat_w), np.int32)
    peak = {'person': (0, 0.0), 'vehicle': (0, 0.0)}; last_crowd = -1e9; key_n = 0; MAX_KEY = 150
    t0 = time.time(); last_prog = 0.0; fi = 0; n_proc = 0

    def keyframe(frame, vis, hi_tid, name):
        nonlocal key_n
        if key_n >= MAX_KEY: return False
        im = frame.copy()
        for zz in zones:
            pts = np.array([[int(p[0] * W), int(p[1] * H)] for p in zz['points']], np.int32)
            ov = im.copy(); cv2.fillPoly(ov, [pts], (0, 204, 255) if zz.get('kind') != 'monitor' else (255, 160, 60)); im = cv2.addWeighted(ov, 0.22, im, 0.78, 0)
            cv2.polylines(im, [pts], True, (0, 204, 255) if zz.get('kind') != 'monitor' else (255, 160, 60), 2)
        for ll in lines:
            p0, p1 = ll['points']; cv2.line(im, (int(p0[0] * W), int(p0[1] * H)), (int(p1[0] * W), int(p1[1] * H)), (255, 255, 255), 2)
        for tr in vis:
            b = [int(v) for v in tr.box]; hot = tr.id == hi_tid
            cv2.rectangle(im, (b[0], b[1]), (b[2], b[3]), (0, 204, 255) if hot else (170, 170, 170), 3 if hot else 1)
            if hot: cv2.putText(im, f'#{tr.id} {tr.cls}', (b[0], max(14, b[1] - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 204, 255), 2)
        s = 640 / im.shape[1]
        if s < 1: im = cv2.resize(im, (640, int(im.shape[0] * s)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(a.out, 'frames', name), im, [cv2.IMWRITE_JPEG_QUALITY, 72]); key_n += 1
        return True

    def add_event(t, typ, sev, label, frame, vis, tid=None, **extra):
        i = len(events)
        has = keyframe(frame, vis, tid, f'ev_{i}.jpg') if len(events) < 2000 else False
        events.append({'i': i, 't': round(t, 2), 'type': typ, 'sev': sev, 'label': label, 'trackId': tid, 'frame': has, **extra})

    while True:
        if not cap.grab(): break
        if fi % step == 0:
            ok, frame = cap.retrieve()
            if not ok: fi += 1; continue
            t = fi / fps; n_proc += 1
            vis = trk.update(det(frame), t)
            pc = sum(1 for v in vis if v.group == 'person'); vc = len(vis) - pc
            counts.append([round(t, 2), pc, vc])
            for g, c in (('person', pc), ('vehicle', vc)):
                if c > peak[g][0]: peak[g] = (c, t)
            boxes = []
            for v in vis:
                seen[v.group].add(v.id)
                ti = tinfo.setdefault(v.id, {'id': v.id, 'group': v.group, 'cls': v.cls, 'first': round(v.first, 2), 'last': round(t, 2), 'n': 0})
                ti['last'] = round(t, 2); ti['n'] = v.n; ti['cls'] = v.cls
                x0, y0, x1, y1 = v.box
                boxes.append([v.id, GCODE[v.group], round(x0 / W, 4), round(y0 / H, 4), round((x1 - x0) / W, 4), round((y1 - y0) / H, 4)])
                if v.group == 'person':
                    fx, fy = (x0 + x1) / 2 / W, y1 / H
                    heat[min(heat_h - 1, max(0, int(fy * heat_h))), min(heat_w - 1, max(0, int(fx * heat_w)))] += 1
            frames_out.append([round(t, 2), boxes])

            # zones
            for z in zones:
                grp = z.get('cls', 'person'); occ = 0
                for v in vis:
                    if v.group != grp: continue
                    foot = ((v.box[0] + v.box[2]) / 2 / W, v.box[3] / H)
                    inside = in_poly(foot, z['points']); k = (z['id'], v.id); s = zstate.setdefault(k, {'inside': False, 'since': 0.0, 'out': 0, 'fired': False})
                    if inside:
                        occ += 1; s['out'] = 0
                        if not s['inside']:
                            s['inside'] = True; s['since'] = t; s['fired'] = False
                            zstats[z['id']]['entries'] += 1; zstats[z['id']]['unique'].add(v.id)
                            nm = 'คน' if grp == 'person' else 'ยานพาหนะ'
                            restricted = z.get('kind', 'restricted') == 'restricted'
                            add_event(t, 'zone_enter', 'bad' if restricted else 'info', f"{nm} #{v.id} เข้า{'พื้นที่หวงห้าม' if restricted else 'โซน'} {z['name']}", frame, vis, v.id, zone=z['id'], group=grp)
                        zstats[z['id']]['dwell'] += dt
                        dw = float(z.get('dwellSec') or 0)
                        if dw > 0 and not s['fired'] and t - s['since'] >= dw:
                            s['fired'] = True
                            add_event(t, 'zone_dwell', 'warn', f"#{v.id} อยู่ใน {z['name']} นานเกิน {int(dw)} วินาที", frame, vis, v.id, zone=z['id'], group=grp)
                    elif s['inside']:
                        s['out'] += 1
                        if s['out'] >= 2: s['inside'] = False
                zstats[z['id']]['peak'] = max(zstats[z['id']]['peak'], occ)
            # lines
            for l in lines:
                p0, p1 = l['points']; grp = l.get('cls', 'person')
                for v in vis:
                    if v.group != grp: continue
                    pt = ((v.box[0] + v.box[2]) / 2 / W, (v.box[3] if grp == 'person' else (v.box[1] + v.box[3]) / 2) / H)
                    sd = side_of(p0, p1, pt); k = (l['id'], v.id); prev = lstate.get(k)
                    if sd != 0:
                        if prev and prev != sd and -0.05 <= seg_u(p0, p1, pt) <= 1.05 and t - lcool.get(k, -9) > 2:
                            d = 'a2b' if prev < 0 else 'b2a'; lstats[l['id']][d] += 1; lcool[k] = t
                            nm = 'คน' if grp == 'person' else 'ยานพาหนะ'
                            add_event(t, 'line_cross', 'info', f"{nm} #{v.id} ข้ามเส้น {l['name']} ({l.get('aLabel', 'A') + '→' + l.get('bLabel', 'B') if d == 'a2b' else l.get('bLabel', 'B') + '→' + l.get('aLabel', 'A')})", frame, vis, v.id, line=l['id'], dir=d, group=grp)
                        lstate[k] = sd
            # crowd
            if crowd_n and pc >= crowd_n and t - last_crowd >= 20:
                last_crowd = t; add_event(t, 'crowd', 'warn', f'พบคนหนาแน่น {pc} คนในภาพพร้อมกัน', frame, vis, None, group='person', n=pc)

            if time.time() - last_prog > 1.0:
                last_prog = time.time(); out({'progress': round(min(0.99, (fi + 1) / total), 3) if total else 0.0, 't': round(t, 1)})
        fi += 1
    cap.release()
    dur = (fi / fps) if fps else 0
    # downsample counts to <= 600 points (max per bucket keeps peaks visible)
    if len(counts) > 600:
        k = math.ceil(len(counts) / 600); counts = [[counts[i][0], max(x[1] for x in counts[i:i + k]), max(x[2] for x in counts[i:i + k])] for i in range(0, len(counts), k)]
    confirmed = [v for v in tinfo.values() if v['n'] >= 3]
    summary = {
        'persons': len(seen['person']), 'vehicles': len(seen['vehicle']),
        'peakPersons': peak['person'][0], 'peakPersonsAt': round(peak['person'][1], 1), 'peakVehicles': peak['vehicle'][0], 'peakVehiclesAt': round(peak['vehicle'][1], 1),
        'zones': [{'id': z['id'], 'name': z['name'], 'kind': z.get('kind', 'restricted'), 'entries': zstats[z['id']]['entries'], 'unique': len(zstats[z['id']]['unique']), 'peak': zstats[z['id']]['peak'], 'dwellSec': round(zstats[z['id']]['dwell'], 1)} for z in zones],
        'lines': [{'id': l['id'], 'name': l['name'], 'aLabel': l.get('aLabel', 'A'), 'bLabel': l.get('bLabel', 'B'), 'a2b': lstats[l['id']]['a2b'], 'b2a': lstats[l['id']]['b2a']} for l in lines],
        'events': len(events), 'alerts': sum(1 for e in events if e['sev'] == 'bad'),
    }
    result = {'meta': {'width': W, 'height': H, 'fps': round(fps, 2), 'duration': round(dur, 2), 'sampleFps': sample_fps, 'samples': n_proc, 'model': MODEL_NAME, 'procSeconds': round(time.time() - t0, 1)},
              'summary': summary, 'config': {'zones': zones, 'lines': lines}, 'events': events, 'counts': counts, 'heat': {'w': heat_w, 'h': heat_h, 'data': heat.flatten().tolist()}, 'frames': frames_out, 'tracks': confirmed}
    json.dump(result, open(os.path.join(a.out, 'result.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    out({'done': True, 'summary': summary, 'meta': result['meta']})


def main():
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('prepare'); a.add_argument('input'); a.add_argument('output'); a.add_argument('--poster', required=True)
    a.add_argument('--codec', default='h264'); a.add_argument('--max-seconds', type=int, default=600); a.add_argument('--maxw', type=int, default=960)
    b = sub.add_parser('analyze'); b.add_argument('video'); b.add_argument('--config', required=True); b.add_argument('--out', required=True)
    args = p.parse_args()
    {'prepare': cmd_prepare, 'analyze': cmd_analyze}[args.cmd](args)


if __name__ == '__main__':
    main()
