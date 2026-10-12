import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp, type HttpDeps } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";
import type { ProbeResult } from "../src/lib/media.js";
import { MemoryAnalyses, MemoryVideos } from "./fakes/memory.js";

export async function createTestApp(overrides: Partial<AppConfig> = {}, probe?: HttpDeps["probe"]) {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "fv-"));
  const config = loadConfig({
    STORAGE_ROOT: storageRoot,
    MAX_UPLOAD_BYTES: "1000000",
    MAX_VIDEO_DURATION_MS: "10000",
    WORKER_ENABLED: "false",
    API_HOST: "127.0.0.1",
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [snake(key), String(value)])),
  });
  Object.assign(config, overrides, { storageRoot: overrides.storageRoot ?? storageRoot });
  const videos = new MemoryVideos();
  const analyses = new MemoryAnalyses();
  const app = await buildApp({
    config,
    videos,
    analyses,
    probe: probe ?? (async () => sampleProbe()),
    decodeCheck: async () => undefined,
    visionHealth: async () => ({
      status: "degraded",
      service: "vision",
      reachable: false,
      modelAvailable: false,
      device: "cpu",
      deviceAvailable: true,
      ffmpeg: true,
      message: "teste",
    }),
    databaseCheck: async () => true,
    ffmpegAvailable: async () => true,
    logger: false,
  });
  return { app, config, videos, analyses, storageRoot };
}

export function sampleProbe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    durationMs: 1000,
    width: 320,
    height: 240,
    nominalFps: 30,
    rotationDegrees: 0,
    codec: "h264",
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    hasAudio: false,
    mimeType: "video/mp4",
    extension: ".mp4",
    ...overrides,
  };
}

export function multipart(filename: string, content: Buffer, type = "video/mp4") {
  const boundary = "----footballvision";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}
