from __future__ import annotations

import json
import subprocess
from pathlib import Path

from app.errors import VideoUnreadable
from app.video.rotation import display_size, normalize_right_angle, read_rotation_degrees


def run_ffprobe(ffprobe: str, path: Path) -> dict:
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        raise VideoUnreadable("FFprobe não conseguiu ler o arquivo.")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise VideoUnreadable("FFprobe devolveu uma resposta inválida.") from exc
    if not isinstance(payload, dict):
        raise VideoUnreadable("FFprobe devolveu uma resposta inválida.")
    return payload


def parse_fps(value: object) -> float | None:
    if not isinstance(value, str) or not value or value == "0/0":
        return None
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            den = float(denominator)
            num = float(numerator)
        except ValueError:
            return None
        if den == 0:
            return None
        fps = num / den
    else:
        try:
            fps = float(value)
        except ValueError:
            return None
    if fps <= 0 or fps > 480:
        return None
    return fps


def parse_video_metadata(payload: dict) -> dict:
    streams = payload.get("streams")
    if not isinstance(streams, list):
        raise VideoUnreadable("O arquivo não contém streams.")
    video = next((stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video"), None)
    if video is None:
        raise VideoUnreadable("O arquivo não contém uma trilha de vídeo.")
    format_info = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    format_name = str(format_info.get("format_name") or "")
    names = {part.strip() for part in format_name.split(",") if part.strip()}
    if names.isdisjoint({"mov", "mp4", "3gp", "3g2", "mj2"}):
        raise VideoUnreadable("Formato recusado. Envie um vídeo MP4 ou MOV.")
    try:
        coded_width = int(video["width"])
        coded_height = int(video["height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise VideoUnreadable("Não foi possível ler a resolução do vídeo.") from exc
    rotation_raw = read_rotation_degrees(video)
    rotation, rotation_warning = normalize_right_angle(rotation_raw)
    width, height = display_size(coded_width, coded_height, rotation)
    fps = parse_fps(video.get("avg_frame_rate")) or parse_fps(video.get("r_frame_rate"))
    if fps is None:
        raise VideoUnreadable("Não foi possível estimar o FPS do vídeo.")
    duration_s = _duration_seconds(format_info, video)
    if duration_s is None or duration_s <= 0:
        raise VideoUnreadable("Não foi possível ler a duração do vídeo.")
    has_audio = any(isinstance(stream, dict) and stream.get("codec_type") == "audio" for stream in streams)
    return {
        "durationMs": int(round(duration_s * 1000)),
        "width": width,
        "height": height,
        "codedWidth": coded_width,
        "codedHeight": coded_height,
        "nominalFps": fps,
        "avgFrameRate": str(video.get("avg_frame_rate") or ""),
        "rotationDegrees": rotation,
        "rotationWarning": rotation_warning,
        "codec": str(video.get("codec_name") or ""),
        "formatName": format_name,
        "hasAudio": has_audio,
    }


def _duration_seconds(format_info: dict, video: dict) -> float | None:
    for source in (format_info, video):
        raw = source.get("duration")
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return None


def probe_video(path: Path, ffprobe: str) -> dict:
    return parse_video_metadata(run_ffprobe(ffprobe, path))
