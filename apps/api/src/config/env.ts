import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1).optional(),
  STORAGE_ROOT: z.string().min(1).default("./storage"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(524_288_000),
  MAX_VIDEO_DURATION_MS: z.coerce.number().int().positive().default(10_800_000),
  FFPROBE_PATH: z.string().min(1).default("ffprobe"),
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  FFPROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_STALE_SECONDS: z.coerce.number().int().positive().default(900),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(2),
  WORKER_RETRY_BACKOFF_SECONDS: z.coerce.number().int().nonnegative().default(20),
  MAX_OBSERVATIONS: z.coerce.number().int().positive().default(2_000_000),
  VISION_BASE_URL: z.string().url().default("http://127.0.0.1:8000"),
  VISION_TIMEOUT_MS: z.coerce.number().int().positive().default(7_200_000),
  SIGNIFICANT_GAP_FACTOR: z.coerce.number().positive().default(2),
  TEMP_TTL_HOURS: z.coerce.number().positive().default(24),
});

export interface AppConfig {
  nodeEnv: string;
  apiHost: string;
  apiPort: number;
  logLevel: string;
  databaseUrl?: string;
  storageRoot: string;
  maxUploadBytes: number;
  maxVideoDurationMs: number;
  ffprobePath: string;
  ffmpegPath: string;
  ffprobeTimeoutMs: number;
  workerEnabled: boolean;
  workerPollMs: number;
  workerStaleSeconds: number;
  workerMaxAttempts: number;
  workerRetryBackoffSeconds: number;
  maxObservations: number;
  visionBaseUrl: string;
  visionTimeoutMs: number;
  significantGapFactor: number;
  tempTtlHours: number;
}

export function findRepoRoot(start = path.dirname(fileURLToPath(import.meta.url))): string {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "prisma", "schema.prisma"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

export function loadDotEnv(envPath = path.join(findRepoRoot(), ".env")): void {
  if (!existsSync(envPath)) {
    return;
  }
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, baseDir = findRepoRoot()): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    apiHost: parsed.API_HOST,
    apiPort: parsed.API_PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    storageRoot: path.resolve(baseDir, parsed.STORAGE_ROOT),
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    maxVideoDurationMs: parsed.MAX_VIDEO_DURATION_MS,
    ffprobePath: parsed.FFPROBE_PATH,
    ffmpegPath: parsed.FFMPEG_PATH,
    ffprobeTimeoutMs: parsed.FFPROBE_TIMEOUT_MS,
    workerEnabled: parsed.WORKER_ENABLED === "true",
    workerPollMs: parsed.WORKER_POLL_MS,
    workerStaleSeconds: parsed.WORKER_STALE_SECONDS,
    workerMaxAttempts: parsed.WORKER_MAX_ATTEMPTS,
    workerRetryBackoffSeconds: parsed.WORKER_RETRY_BACKOFF_SECONDS,
    maxObservations: parsed.MAX_OBSERVATIONS,
    visionBaseUrl: parsed.VISION_BASE_URL,
    visionTimeoutMs: parsed.VISION_TIMEOUT_MS,
    significantGapFactor: parsed.SIGNIFICANT_GAP_FACTOR,
    tempTtlHours: parsed.TEMP_TTL_HOURS,
  };
}
