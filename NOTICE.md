# Third-party components

| Component | Use | License |
|---|---|---|
| YOLOX-Tiny (Megvii-BaseDetection/YOLOX) ONNX weights | person / vehicle detector | Apache-2.0 |
| ONNX Runtime | runs the detector on CPU | MIT |
| OpenCV (opencv-python-headless) | video decode, drawing, NMS | Apache-2.0 |
| NumPy | array math | BSD-3-Clause |
| FFmpeg (separate process, from the OS package) | preview conversion | LGPL/GPL build as packaged by the OS; invoked as an external program, not linked |
| Express, node-postgres, PGlite | server, database | MIT / MIT / Apache-2.0 |
| Fontsource: Saira Semi Condensed, IBM Plex Sans Thai, IBM Plex Mono | fonts | SIL OFL-1.1 |

The tracker, zone / line logic and event rules are original code written for this project.
No code, model or image from `CU-DrAgon/rocm-cctv-analysis` (PolyForm Noncommercial 1.0.0) is included.
Re-check each license before adding any new model or dataset; see README "Adding modules".
