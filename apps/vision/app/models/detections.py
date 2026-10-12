from __future__ import annotations

from dataclasses import dataclass


PERSON_CLASS_ID = 0


@dataclass(frozen=True)
class Detection:
    tracker_id: int
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
