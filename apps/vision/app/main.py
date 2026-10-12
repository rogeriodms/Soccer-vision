from __future__ import annotations

import logging
import os

os.environ.setdefault("YOLO_AUTOINSTALL", "false")
os.environ.setdefault("YOLO_OFFLINE", "true")
os.environ.setdefault("YOLO_VERBOSE", "false")

from app.api.routes import create_app
from app.config import load_settings, repo_root


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), format="%(levelname)s %(name)s %(message)s")


def build_default_app():
    env_file = repo_root() / ".env"
    settings = load_settings(env_file if env_file.is_file() else None)
    _configure_logging(settings.log_level)
    return create_app(settings)


app = build_default_app()
