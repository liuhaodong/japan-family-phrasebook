FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

COPY index.html styles.css app.js oral_coach.js learning.js sensei_ui.js live_audio_worklet.js sw.js manifest.json ./
COPY data/ ./data/
COPY audio/ ./audio/
COPY vendor/ ./vendor/
COPY docs/ ./docs/
COPY server/ ./server/

RUN mkdir -p server/cache/tts server/cache/turns server/cache/stories server/data \
    && python -c "from server.services.curriculum_loader import load_curriculum; load_curriculum(force_reload=True)"

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT} --ws-ping-interval 20 --ws-ping-timeout 20"]
