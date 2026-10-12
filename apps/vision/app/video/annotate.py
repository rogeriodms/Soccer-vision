from __future__ import annotations

import subprocess
from collections.abc import Iterator
from fractions import Fraction
from pathlib import Path

import av
import cv2
import numpy as np

from app.errors import VideoUnreadable
from app.models.detections import Detection


def format_timestamp(timestamp_ms: int) -> str:
    total_ms = max(0, int(timestamp_ms))
    minutes, remainder = divmod(total_ms, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{minutes:02d}:{seconds:02d}.{millis:03d}"


def draw_overlay(
    frame: np.ndarray,
    detections: list[Detection],
    timestamp_ms: int,
    *,
    draw_boxes: bool,
) -> np.ndarray:
    image = frame.copy()
    if draw_boxes:
        for detection in detections:
            x1, y1, x2, y2 = (int(round(value)) for value in (detection.x1, detection.y1, detection.x2, detection.y2))
            cv2.rectangle(image, (x1, y1), (x2, y2), (40, 220, 40), 2)
            label = f"ID {detection.tracker_id} {detection.confidence:.2f}"
            origin = (x1, max(20, y1 - 6))
            cv2.putText(image, label, origin, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3, cv2.LINE_AA)
            cv2.putText(image, label, origin, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    stamp = format_timestamp(timestamp_ms)
    cv2.putText(image, stamp, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(image, stamp, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return image


def pad_even(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    pad_bottom = height % 2
    pad_right = width % 2
    if not pad_bottom and not pad_right:
        return image
    return cv2.copyMakeBorder(image, 0, pad_bottom, 0, pad_right, cv2.BORDER_CONSTANT, value=(0, 0, 0))


def write_silent_video(
    frames: Iterator[tuple[np.ndarray, int, list[Detection], bool]],
    destination: Path,
    fps: float,
) -> tuple[int, int, int]:
    if fps <= 0:
        raise VideoUnreadable("FPS inválido para o vídeo anotado.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    container = av.open(str(destination), mode="w")
    stream = None
    count = 0
    width = 0
    height = 0
    try:
        rate = Fraction(fps).limit_denominator(100_000)
        for image, timestamp_ms, detections, draw_boxes in frames:
            annotated = pad_even(draw_overlay(image, detections, timestamp_ms, draw_boxes=draw_boxes))
            if stream is None:
                height, width = annotated.shape[:2]
                stream = container.add_stream("libx264", rate=rate)
                stream.width = width
                stream.height = height
                stream.pix_fmt = "yuv420p"
                stream.options = {"crf": "23", "preset": "veryfast"}
            frame = av.VideoFrame.from_ndarray(annotated, format="bgr24")
            for packet in stream.encode(frame):
                container.mux(packet)
            count += 1
        if stream is None:
            raise VideoUnreadable("Nenhum frame foi escrito no vídeo anotado.")
        for packet in stream.encode():
            container.mux(packet)
    except av.FFmpegError as exc:
        raise VideoUnreadable("Falha ao gerar o vídeo anotado.") from exc
    finally:
        container.close()
    return count, width, height


def mux_original_audio(ffmpeg: str, silent_video: Path, original: Path, output: Path) -> bool:
    completed = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(silent_video),
            "-i",
            str(original),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            str(output),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0 and output.is_file() and output.stat().st_size > 0
