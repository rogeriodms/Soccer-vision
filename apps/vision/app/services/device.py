from __future__ import annotations

from app.errors import DeviceUnavailable


def resolve_device(requested: str) -> str:
    normalized = requested.strip()
    lowered = normalized.lower()
    if lowered == "cpu":
        return "cpu"
    if lowered == "mps":
        import torch

        backend = getattr(torch.backends, "mps", None)
        if backend is None or not backend.is_available():
            raise DeviceUnavailable("MPS foi solicitado, mas não está disponível neste processo.")
        return "mps"
    if lowered.startswith("cuda"):
        import torch

        if not torch.cuda.is_available():
            raise DeviceUnavailable(
                "CUDA foi solicitado, mas esta instalação não enxerga uma GPU compatível. "
                "Use VISION_DEVICE=cpu ou instale um PyTorch compilado com CUDA."
            )
        return normalized
    raise DeviceUnavailable(f"Dispositivo não suportado: {requested}")


def device_available(requested: str) -> bool:
    try:
        resolve_device(requested)
    except DeviceUnavailable:
        return False
    return True
