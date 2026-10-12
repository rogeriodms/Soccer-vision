from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import av
import numpy as np

from app.errors import VideoUnreadable
from app.video.rotation import apply_display_rotation


def read_presentation_clock(path: Path) -> list[float | None]:
    container = av.open(str(path))
    try:
        stream = container.streams.video[0]
        time_base = stream.time_base
        clocks: list[float | None] = []
        for frame in container.decode(stream):
            if frame.time is not None:
                clocks.append(float(frame.time))
            elif frame.pts is not None and time_base is not None:
                clocks.append(float(frame.pts * time_base))
            else:
                clocks.append(None)
        return clocks
    except av.FFmpegError as exc:
        raise VideoUnreadable("Falha ao ler os timestamps do vídeo.") from exc
    finally:
        container.close()


def iter_bgr_frames(path: Path, rotation: int) -> Iterator[tuple[int, np.ndarray]]:
    container = av.open(str(path))
    try:
        stream = container.streams.video[0]
        for index, frame in enumerate(container.decode(stream)):
            image = frame.to_ndarray(format="bgr24")
            yield index, apply_display_rotation(image, rotation)
    except av.FFmpegError as exc:
        raise VideoUnreadable("Falha ao decodificar os frames do vídeo.") from exc
    finally:
        container.close()
