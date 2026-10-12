import { AppError, sanitizeErrorMessage } from "../lib/errors.js";
import { visionSummarySchema, type VisionSummary } from "../schemas/http.js";

export class VisionRequestError extends AppError {
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean, statusCode = 502) {
    super(statusCode, code, message);
    this.retryable = retryable;
  }
}

export async function requestVisionAnalysis(input: {
  baseUrl: string;
  timeoutMs: number;
  body: Record<string, unknown>;
}): Promise<VisionSummary> {
  let response: Response;
  try {
    response = await fetch(new URL("/v1/analyze", input.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new VisionRequestError(
      timedOut ? "TIMEOUT" : "VISION_UNAVAILABLE",
      sanitizeErrorMessage(timedOut ? "TIMEOUT" : "VISION_UNAVAILABLE"),
      true,
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? (payload as { error?: string; message?: string }) : {};
    const code = typeof record.error === "string" ? record.error : "VISION_FAILED";
    const retryable = response.status >= 500 || response.status === 429 || code === "VISION_BUSY";
    throw new VisionRequestError(code, sanitizeErrorMessage(code, record.message), retryable, response.status);
  }
  const parsed = visionSummarySchema.safeParse(payload);
  if (!parsed.success) {
    throw new VisionRequestError("VISION_FAILED", sanitizeErrorMessage("VISION_FAILED"), false);
  }
  return parsed.data;
}

export async function requestVisionHealth(baseUrl: string): Promise<{
  reachable: boolean;
  modelAvailable: boolean;
  device: string | null;
  deviceAvailable: boolean;
  ffmpeg: boolean;
  message: string | null;
}> {
  try {
    const response = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return {
        reachable: false,
        modelAvailable: false,
        device: null,
        deviceAvailable: false,
        ffmpeg: false,
        message: "O serviço de visão respondeu com erro.",
      };
    }
    const body = (await response.json()) as {
      modelAvailable?: boolean;
      device?: string;
      deviceAvailable?: boolean;
      ffmpeg?: boolean;
      weightsHelp?: string | null;
    };
    return {
      reachable: true,
      modelAvailable: body.modelAvailable === true,
      device: body.device ?? null,
      deviceAvailable: body.deviceAvailable === true,
      ffmpeg: body.ffmpeg === true,
      message: body.modelAvailable ? null : (body.weightsHelp ?? "Pesos YOLO indisponíveis."),
    };
  } catch {
    return {
      reachable: false,
      modelAvailable: false,
      device: null,
      deviceAvailable: false,
      ffmpeg: false,
      message: "Serviço de visão inacessível.",
    };
  }
}
