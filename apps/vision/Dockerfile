FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 libgl1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/vision/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir torch==2.14.1+cpu torchvision==0.29.1+cpu --index-url https://download.pytorch.org/whl/cpu \
  && pip install --no-cache-dir -r /tmp/requirements.txt
COPY apps/vision /app
ENV PYTHONPATH=/app \
    YOLO_AUTOINSTALL=false \
    YOLO_OFFLINE=true \
    VISION_HOST=0.0.0.0 \
    STORAGE_ROOT=/app/storage \
    MODELS_DIR=/app/models
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
