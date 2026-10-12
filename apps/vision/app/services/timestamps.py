from __future__ import annotations


def assign_timestamps(
    clocks_s: list[float | None],
    nominal_fps: float,
) -> tuple[list[int], str, int, list[str]]:
    """Converte o relógio do decoder em milissegundos.

    Usa o PTS de apresentação quando ele existe e é monotônico.
    Caso contrário, cai para frame_index / FPS nominal e registra a incerteza.
    Não usa frame_amostrado / sample_fps.
    """
    if nominal_fps <= 0:
        raise ValueError("FPS nominal inválido.")
    count = len(clocks_s)
    frame_period_ms = max(1, int(round(1000.0 / nominal_fps)))
    fallback = [int(round(index * 1000.0 / nominal_fps)) for index in range(count)]
    warnings: list[str] = []
    if count == 0:
        warnings.append("O vídeo não tem frames decodificáveis.")
        return [], "nominal_fps_fallback", frame_period_ms, warnings
    if any(value is None for value in clocks_s):
        warnings.append(
            "Alguns frames não tinham PTS do decoder. Os timestamps usam o FPS nominal. "
            f"A incerteza é de cerca de {frame_period_ms} ms."
        )
        return fallback, "nominal_fps_fallback", frame_period_ms, warnings
    decoded = [int(round(float(value) * 1000.0)) for value in clocks_s]
    if any(decoded[index] < decoded[index - 1] for index in range(1, count)):
        warnings.append(
            "Os PTS do decoder não são monotônicos. Os timestamps usam o FPS nominal. "
            f"A incerteza é de cerca de {frame_period_ms} ms."
        )
        return fallback, "nominal_fps_fallback", frame_period_ms, warnings
    warnings.append(
        "Timestamps obtidos do PTS de apresentação do decoder e arredondados para milissegundos."
    )
    return decoded, "decoder_pts", 1, warnings


def gap_threshold_ms(sample_fps: float, factor: float = 2.0) -> float:
    if sample_fps <= 0 or factor <= 0:
        raise ValueError("Parâmetros de lacuna inválidos.")
    interval = 1000.0 / sample_fps
    return interval * factor + interval * 0.25
