export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const SAFE_MESSAGES: Record<string, string> = {
  MODEL_WEIGHTS_MISSING:
    "Pesos do modelo YOLO não encontrados no serviço de visão. Execute python3 scripts/download_yolo_weights.py.",
  VIDEO_UNREADABLE: "Não foi possível decodificar o vídeo.",
  VISION_UNAVAILABLE: "Serviço de visão indisponível.",
  VISION_FAILED: "Falha no processamento de visão.",
  VISION_BUSY: "Serviço de visão ocupado. A análise será tentada de novo.",
  DEVICE_UNAVAILABLE: "O dispositivo de inferência configurado não está disponível.",
  TIMESTAMP_INCOHERENT: "Os timestamps produzidos não passaram na validação.",
  RESULT_MISMATCH: "O resultado do serviço de visão não confere com a configuração da análise.",
  TIMEOUT: "O processamento excedeu o tempo limite.",
  STALE_CLAIM: "O processamento expirou após o número máximo de tentativas.",
  TOO_MANY_OBSERVATIONS: "A análise gerou observações demais para o limite configurado.",
};

export function looksLikeStack(message: string): boolean {
  return /traceback|node_modules|at \w+ \(|exception in/i.test(message);
}

export function sanitizeErrorMessage(code: string, raw?: string): string {
  const known = SAFE_MESSAGES[code];
  if (!raw) {
    return known ?? "Falha no processamento de visão.";
  }
  const single = raw.replace(/\s+/g, " ").trim();
  if (!single || single.length > 300 || looksLikeStack(single)) {
    return known ?? "Falha no processamento de visão.";
  }
  return single;
}
