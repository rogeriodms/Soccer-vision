from __future__ import annotations


def select_sample_indices(timestamps_ms: list[int], sample_fps: float) -> list[int]:
    """Escolhe frames em ordem temporal, sem reprocessar o mesmo índice.

    A taxa pedida é um alvo. Se o vídeo tiver menos frames, todos podem entrar.
    O rastreador recebe só esta sequência, sempre na ordem original.
    """
    if sample_fps <= 0:
        raise ValueError("sample_fps deve ser positivo.")
    if not timestamps_ms:
        return []
    interval = 1000.0 / sample_fps
    selected = [0]
    next_due = timestamps_ms[0] + interval
    for index in range(1, len(timestamps_ms)):
        timestamp = timestamps_ms[index]
        if timestamp + 1e-6 < next_due:
            continue
        selected.append(index)
        steps = int((timestamp - next_due) / interval) + 1
        next_due += steps * interval
    return selected
