from __future__ import annotations

import cv2
import numpy as np


def read_rotation_degrees(stream: dict) -> float:
    side_data = stream.get("side_data_list")
    if isinstance(side_data, list):
        for item in side_data:
            if isinstance(item, dict) and "rotation" in item:
                try:
                    return float(item["rotation"])
                except (TypeError, ValueError):
                    continue
    tags = stream.get("tags")
    if isinstance(tags, dict) and "rotate" in tags:
        try:
            return float(tags["rotate"])
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def normalize_right_angle(value: float) -> tuple[int, str | None]:
    angle = int(round(value)) % 360
    if angle < 0:
        angle += 360
    for target in (0, 90, 180, 270):
        delta = min(abs(angle - target), 360 - abs(angle - target))
        if delta <= 2:
            return target, None
    return 0, (
        f"Rotação de {value} graus não é um múltiplo de 90. "
        "Os frames foram analisados na orientação codificada."
    )


def display_size(width: int, height: int, rotation: int) -> tuple[int, int]:
    if rotation in (90, 270):
        return height, width
    return width, height


def apply_display_rotation(image: np.ndarray, rotation: int) -> np.ndarray:
    """Aplica a mesma orientação que o FFmpeg usa com autorotate.

    Verificado com uma barra branca à esquerda:
    rotação 90 vai para baixo, -90/270 vai para cima, 180 vai para a direita.
    """
    if rotation == 90:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if rotation == 270:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if rotation == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    return image
