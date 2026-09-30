FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data
# Python + onnxruntime for the detector, ffmpeg (separate process) for preview conversion.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg curl ca-certificates libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/requirements.txt worker/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r worker/requirements.txt
ENV PYTHON_BIN=/opt/venv/bin/python
COPY scripts/get-model.sh scripts/get-model.sh
RUN sh scripts/get-model.sh
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY worker/analyze.py worker/analyze.py
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
