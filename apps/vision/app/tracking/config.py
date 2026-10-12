from __future__ import annotations

from pathlib import Path


def write_tracker_config(
    path: Path,
    tracker: str,
    sample_fps: float,
    buffer_seconds: float,
    gmc_method: str,
) -> dict:
    if tracker not in {"botsort", "bytetrack"}:
        raise ValueError(f"Rastreador não suportado: {tracker}")
    if sample_fps <= 0 or buffer_seconds <= 0:
        raise ValueError("Parâmetros do rastreador inválidos.")
    track_buffer = max(1, int(round(sample_fps * buffer_seconds)))
    config: dict[str, object] = {
        "tracker_type": tracker,
        "track_high_thresh": 0.25,
        "track_low_thresh": 0.1,
        "new_track_thresh": 0.25,
        "track_buffer": track_buffer,
        "match_thresh": 0.8,
        "fuse_score": True,
    }
    lines = [
        f"tracker_type: {tracker}",
        "track_high_thresh: 0.25",
        "track_low_thresh: 0.1",
        "new_track_thresh: 0.25",
        f"track_buffer: {track_buffer}",
        "match_thresh: 0.8",
        "fuse_score: True",
    ]
    if tracker == "botsort":
        config.update(
            {
                "gmc_method": gmc_method,
                "proximity_thresh": 0.5,
                "appearance_thresh": 0.8,
                "with_reid": False,
                "model": "auto",
            }
        )
        lines.extend(
            [
                f"gmc_method: {gmc_method}",
                "proximity_thresh: 0.5",
                "appearance_thresh: 0.8",
                "with_reid: False",
                "model: auto",
            ]
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return config
