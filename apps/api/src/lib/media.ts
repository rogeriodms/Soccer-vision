import { AppError } from "./errors.js";

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

export interface ProbePayload {
  format?: { duration?: string; format_name?: string };
  streams?: ProbeStream[];
}

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  nominalFps: number;
  rotationDegrees: number;
  codec: string;
  formatName: string;
  hasAudio: boolean;
  mimeType: string;
  extension: ".mp4" | ".mov";
}

export function parseFps(value: string | undefined): number | null {
  if (!value || value === "0/0") {
    return null;
  }
  const parts = value.split("/");
  const numerator = Number(parts[0]);
  const denominator = parts[1] === undefined ? 1 : Number(parts[1]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const fps = numerator / denominator;
  if (fps <= 0 || fps > 480) {
    return null;
  }
  return fps;
}

export function normalizeRightAngle(value: number): { rotation: number; warning: string | null } {
  let angle = Math.round(value) % 360;
  if (angle < 0) {
    angle += 360;
  }
  for (const target of [0, 90, 180, 270]) {
    const delta = Math.min(Math.abs(angle - target), 360 - Math.abs(angle - target));
    if (delta <= 2) {
      return { rotation: target, warning: null };
    }
  }
  return {
    rotation: 0,
    warning: `Rotação de ${value} graus não é um múltiplo de 90. A orientação codificada foi mantida.`,
  };
}

export function readRotation(stream: ProbeStream): number {
  const side = stream.side_data_list?.find((item) => typeof item.rotation === "number");
  if (side && typeof side.rotation === "number") {
    return side.rotation;
  }
  if (stream.tags?.rotate !== undefined) {
    const parsed = Number(stream.tags.rotate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function displaySize(width: number, height: number, rotation: number): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

export function parseProbe(payload: unknown, limits: { maxDurationMs: number }): ProbeResult {
  if (!payload || typeof payload !== "object") {
    throw new AppError(400, "invalid_video", "Não foi possível ler os metadados do vídeo.");
  }
  const body = payload as ProbePayload;
  const streams = Array.isArray(body.streams) ? body.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) {
    throw new AppError(400, "invalid_video", "O arquivo não contém uma trilha de vídeo.");
  }
  const formatName = body.format?.format_name ?? "";
  const names = new Set(formatName.split(",").map((part) => part.trim()).filter(Boolean));
  if (![...names].some((name) => ["mov", "mp4", "3gp", "3g2", "mj2"].includes(name))) {
    throw new AppError(400, "invalid_video", "Formato recusado. Envie um vídeo MP4 ou MOV.");
  }
  if (!Number.isInteger(video.width) || !Number.isInteger(video.height) || !video.width || !video.height) {
    throw new AppError(400, "invalid_video", "Não foi possível ler a resolução do vídeo.");
  }
  const rotation = normalizeRightAngle(readRotation(video)).rotation;
  const size = displaySize(video.width, video.height, rotation);
  const fps = parseFps(video.avg_frame_rate) ?? parseFps(video.r_frame_rate);
  if (fps === null) {
    throw new AppError(400, "invalid_video", "Não foi possível estimar o FPS do vídeo.");
  }
  const durationSeconds = readDuration(body.format?.duration) ?? readDuration(video.duration);
  if (durationSeconds === null) {
    throw new AppError(400, "invalid_video", "Não foi possível ler a duração do vídeo.");
  }
  const durationMs = Math.round(durationSeconds * 1000);
  if (durationMs < 50) {
    throw new AppError(400, "invalid_video", "O vídeo é curto demais para análise.");
  }
  if (durationMs > limits.maxDurationMs) {
    throw new AppError(400, "video_too_long", "O vídeo excede a duração máxima configurada.");
  }
  const extension = names.has("mp4") ? ".mp4" : ".mov";
  return {
    durationMs,
    width: size.width,
    height: size.height,
    nominalFps: fps,
    rotationDegrees: rotation,
    codec: video.codec_name ?? "",
    formatName,
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    mimeType: extension === ".mp4" ? "video/mp4" : "video/quicktime",
    extension,
  };
}

function readDuration(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
