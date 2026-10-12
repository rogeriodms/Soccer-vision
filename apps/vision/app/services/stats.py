from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Observation:
    tracker_id: int
    frame_number: int
    timestamp_ms: int
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float


@dataclass(frozen=True)
class TrackStats:
    tracker_id: int
    first_seen_ms: int
    last_seen_ms: int
    observation_count: int
    observed_duration_ms: int
    average_confidence: float
    detection_ratio: float
    gap_count: int


def dedupe_observations(observations: list[Observation]) -> list[Observation]:
    best: dict[tuple[int, int], Observation] = {}
    for observation in observations:
        key = (observation.tracker_id, observation.frame_number)
        current = best.get(key)
        if current is None or observation.confidence > current.confidence:
            best[key] = observation
    return list(best.values())


def compute_track_stats(
    observations: list[Observation],
    sampled_frame_count: int,
    gap_threshold: float,
) -> list[TrackStats]:
    if sampled_frame_count < 0:
        raise ValueError("sampled_frame_count inválido.")
    grouped: dict[int, list[Observation]] = {}
    for observation in dedupe_observations(observations):
        grouped.setdefault(observation.tracker_id, []).append(observation)
    stats: list[TrackStats] = []
    for tracker_id, items in grouped.items():
        items.sort(key=lambda item: (item.timestamp_ms, item.frame_number))
        first = items[0]
        last = items[-1]
        gaps = 0
        for previous, current in zip(items, items[1:]):
            if current.timestamp_ms - previous.timestamp_ms > gap_threshold:
                gaps += 1
        confidence = round(sum(item.confidence for item in items) / len(items), 6)
        ratio = 0.0 if sampled_frame_count == 0 else len(items) / sampled_frame_count
        stats.append(
            TrackStats(
                tracker_id=tracker_id,
                first_seen_ms=first.timestamp_ms,
                last_seen_ms=last.timestamp_ms,
                observation_count=len(items),
                observed_duration_ms=last.timestamp_ms - first.timestamp_ms,
                average_confidence=confidence,
                detection_ratio=ratio,
                gap_count=gaps,
            )
        )
    stats.sort(key=lambda item: item.tracker_id)
    return stats
