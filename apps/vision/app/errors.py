WEIGHTS_HELP = (
    "Os pesos não estão disponíveis. Na raiz do repositório execute "
    "`python3 scripts/download_yolo_weights.py`. "
    "O serviço não baixa pesos durante uma análise."
)


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class ModelWeightsMissing(AppError):
    def __init__(self, model_name: str) -> None:
        super().__init__(
            "MODEL_WEIGHTS_MISSING",
            f"Pesos YOLO '{model_name}' não encontrados. {WEIGHTS_HELP}",
            409,
        )


class DeviceUnavailable(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("DEVICE_UNAVAILABLE", message, 409)


class VideoUnreadable(AppError):
    def __init__(self, message: str = "Não foi possível decodificar o vídeo.") -> None:
        super().__init__("VIDEO_UNREADABLE", message, 422)


class PathEscapeError(AppError):
    def __init__(self) -> None:
        super().__init__("INVALID_PATH", "O caminho está fora do diretório de armazenamento.", 400)


class VisionBusy(AppError):
    def __init__(self) -> None:
        super().__init__("VISION_BUSY", "O serviço de visão já está processando um vídeo.", 503)
