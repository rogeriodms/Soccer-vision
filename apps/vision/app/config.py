from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.paths import resolve_inside


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / "prisma" / "schema.prisma").is_file():
            return candidate
    return Path.cwd()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    vision_host: str = "127.0.0.1"
    vision_port: int = 8000
    storage_root: Path = Path("storage")
    models_dir: Path = Path("models")
    yolo_model: str = "yolo11n.pt"
    vision_device: str = "cpu"
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    track_buffer_seconds: float = 3.0
    significant_gap_factor: float = 2.0
    gmc_method: str = "sparseOptFlow"
    max_observations: int = 2_000_000
    log_level: str = "INFO"

    def resolved_storage_root(self, root: Path | None = None) -> Path:
        base = root or repo_root()
        path = self.storage_root if self.storage_root.is_absolute() else base / self.storage_root
        return path.resolve()

    def resolved_models_dir(self, root: Path | None = None) -> Path:
        base = root or repo_root()
        path = self.models_dir if self.models_dir.is_absolute() else base / self.models_dir
        return path.resolve()

    def resolved_model_path(self, root: Path | None = None) -> Path:
        models_dir = self.resolved_models_dir(root)
        raw = Path(self.yolo_model)
        if raw.is_absolute() or len(raw.parts) != 1 or raw.name != self.yolo_model:
            raise ValueError("YOLO_MODEL deve ser apenas o nome do arquivo dentro de MODELS_DIR.")
        return resolve_inside(models_dir, raw.name)


def load_settings(env_file: Path | None = None) -> Settings:
    if env_file and env_file.is_file():
        return Settings(_env_file=env_file)
    return Settings()


def apply_process_guards() -> None:
    os.environ.setdefault("YOLO_AUTOINSTALL", "false")
    os.environ.setdefault("YOLO_OFFLINE", "true")
    os.environ.setdefault("YOLO_VERBOSE", "false")
