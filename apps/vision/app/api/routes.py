from __future__ import annotations

import hashlib
import json
import logging
import shutil
import threading
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings
from app.errors import AppError, ModelWeightsMissing, VisionBusy, WEIGHTS_HELP
from app.services.device import device_available, resolve_device
from app.services.paths import resolve_inside
from app.services.pipeline import analyze_video

LOGGER = logging.getLogger("vision")
_JOB_LOCK = threading.Lock()
_MODEL_LOCK = threading.Lock()
_TRACKERS: dict[tuple[str, str], object] = {}


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    videoPath: str
    outputDir: str
    sampleFps: float = Field(gt=0, le=15)
    confidenceThreshold: float = Field(ge=0.01, le=0.95)
    tracker: str
    generateAnnotatedVideo: bool = False
    analysisId: str | None = None
    videoId: str | None = None


def _command_available(command: str) -> bool:
    if Path(command).is_file():
        return True
    return shutil.which(command) is not None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tracker_for(model_path: Path, device: str):
    key = (str(model_path), device)
    with _MODEL_LOCK:
        cached = _TRACKERS.get(key)
        if cached is None:
            from app.models.detector import YoloPersonTracker

            cached = YoloPersonTracker(model_path, device)
            _TRACKERS[key] = cached
        return cached


def _write_progress(path: Path, stage: str, progress: int) -> None:
    payload = json.dumps({"stage": stage, "progress": progress})
    temporary = path.with_suffix(".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(path)


def build_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    def health() -> dict:
        try:
            model_path = settings.resolved_model_path()
            model_available = model_path.is_file()
        except ValueError:
            model_available = False
        device = settings.vision_device
        return {
            "status": "ok" if model_available else "degraded",
            "service": "vision",
            "modelName": Path(settings.yolo_model).name,
            "modelAvailable": model_available,
            "device": device,
            "deviceAvailable": device_available(device),
            "ffmpeg": _command_available(settings.ffmpeg_path),
            "ffprobe": _command_available(settings.ffprobe_path),
            "trackers": ["botsort", "bytetrack"],
            "weightsHelp": None if model_available else WEIGHTS_HELP,
            "offlineMode": True,
        }

    @router.post("/v1/analyze")
    def analyze(body: AnalyzeRequest, request: Request) -> dict:
        if body.tracker not in {"botsort", "bytetrack"}:
            return JSONResponse(
                status_code=422,
                content={"error": "invalid_tracker", "message": "Rastreador disponível: botsort ou bytetrack."},
            )
        acquired = _JOB_LOCK.acquire(blocking=False)
        if not acquired:
            raise VisionBusy()
        try:
            storage_root = settings.resolved_storage_root()
            video_path = resolve_inside(storage_root, body.videoPath)
            output_dir = resolve_inside(storage_root, body.outputDir)
            if not video_path.is_file():
                return JSONResponse(
                    status_code=422,
                    content={"error": "VIDEO_UNREADABLE", "message": "O vídeo informado não existe no armazenamento."},
                )
            model_path = settings.resolved_model_path()
            if not model_path.is_file():
                raise ModelWeightsMissing(Path(settings.yolo_model).name)
            device = resolve_device(settings.vision_device)
            progress_path = output_dir / "progress.json"
            output_dir.mkdir(parents=True, exist_ok=True)

            def report(stage: str, value: int) -> None:
                _write_progress(progress_path, stage, value)
                LOGGER.info(
                    "progress",
                    extra={"analysisId": body.analysisId, "videoId": body.videoId, "stage": stage, "progress": value},
                )

            tracker = _tracker_for(model_path, device)
            return analyze_video(
                video_path=video_path,
                output_dir=output_dir,
                storage_root=storage_root,
                sample_fps=body.sampleFps,
                confidence_threshold=body.confidenceThreshold,
                tracker_name=body.tracker,
                generate_annotated_video=body.generateAnnotatedVideo,
                model_name=model_path.name,
                model_sha256=_sha256(model_path),
                device=device,
                ffmpeg_path=settings.ffmpeg_path,
                ffprobe_path=settings.ffprobe_path,
                track_buffer_seconds=settings.track_buffer_seconds,
                gap_factor=settings.significant_gap_factor,
                gmc_method=settings.gmc_method,
                tracker=tracker,
                progress=report,
                max_observations=settings.max_observations,
            )
        finally:
            _JOB_LOCK.release()

    return router


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="Football Vision",
        version="0.1.0",
        description="Detecção e rastreamento de pessoas em vídeo de futebol. Sem autenticação. Uso local.",
    )
    app.state.settings = settings

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        LOGGER.warning("%s %s", exc.code, exc.message)
        return JSONResponse(status_code=exc.status, content={"error": exc.code, "message": exc.message})

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        LOGGER.exception("falha não tratada no serviço de visão")
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "message": "Erro interno no serviço de visão."},
        )

    app.include_router(build_router(settings))
    return app
