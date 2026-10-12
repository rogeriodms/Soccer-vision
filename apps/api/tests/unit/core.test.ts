import path from "node:path";
import { describe, expect, it } from "vitest";
import { gapThresholdMs } from "@football-vision/shared";
import { findRepoRoot, loadConfig } from "../../src/config/env.js";
import { AppError } from "../../src/lib/errors.js";
import { parseProbe } from "../../src/lib/media.js";
import { resolveInside } from "../../src/lib/paths.js";
import { buildTracks } from "../../src/lib/stats.js";
import { canTransition } from "../../src/lib/state.js";
import { validateTimestampSeries } from "../../src/lib/timestamps.js";
import { analysisConfigSchema } from "../../src/schemas/http.js";

describe("raiz de armazenamento", () => {
  it("resolve STORAGE_ROOT relativo à raiz do repositório", () => {
    const config = loadConfig({ STORAGE_ROOT: "./storage" });
    expect(config.storageRoot).toBe(path.resolve(findRepoRoot(), "storage"));
  });
});

describe("parâmetros da análise", () => {
  it("aplica defaults seguros", () => {
    expect(analysisConfigSchema.parse({})).toEqual({
      sampleFps: 3,
      confidenceThreshold: 0.25,
      tracker: "botsort",
      generateAnnotatedVideo: false,
    });
  });

  it("rejeita sampleFps, confiança, rastreador e campos desconhecidos", () => {
    expect(analysisConfigSchema.safeParse({ sampleFps: 0 }).success).toBe(false);
    expect(analysisConfigSchema.safeParse({ sampleFps: 30 }).success).toBe(false);
    expect(analysisConfigSchema.safeParse({ confidenceThreshold: 0 }).success).toBe(false);
    expect(analysisConfigSchema.safeParse({ tracker: "deepsort" }).success).toBe(false);
    expect(analysisConfigSchema.safeParse({ sampleFps: 3, extra: true }).success).toBe(false);
  });
});

describe("estatísticas de tracks", () => {
  it("calcula duração observada, confiança, proporção e lacuna sem tratar isso como tempo de jogo", () => {
    const threshold = gapThresholdMs(3);
    expect(threshold).toBeCloseTo(750, 5);
    const tracks = buildTracks(
      [
        { trackerId: 7, frameNumber: 0, timestampMs: 0, x1: 1, y1: 2, x2: 10, y2: 20, confidence: 0.5 },
        { trackerId: 7, frameNumber: 10, timestampMs: 500, x1: 2, y1: 2, x2: 12, y2: 22, confidence: 0.7 },
        { trackerId: 7, frameNumber: 40, timestampMs: 2000, x1: 3, y1: 4, x2: 14, y2: 24, confidence: 0.9 },
      ],
      10,
      threshold,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      trackerId: 7,
      firstSeenMs: 0,
      lastSeenMs: 2000,
      observationCount: 3,
      observedDurationMs: 2000,
      averageConfidence: 0.7,
      detectionRatio: 0.3,
      gapCount: 1,
      minX1: 1,
      minY1: 2,
      maxX2: 14,
      maxY2: 24,
    });
  });

  it("não duplica duas detecções do mesmo track no mesmo frame", () => {
    const tracks = buildTracks(
      [
        { trackerId: 1, frameNumber: 4, timestampMs: 100, x1: 0, y1: 0, x2: 5, y2: 5, confidence: 0.4 },
        { trackerId: 1, frameNumber: 4, timestampMs: 100, x1: 1, y1: 1, x2: 6, y2: 6, confidence: 0.8 },
      ],
      4,
      750,
    );
    expect(tracks[0]?.observationCount).toBe(1);
    expect(tracks[0]?.averageConfidence).toBeCloseTo(0.8);
    expect(tracks[0]?.observations[0]?.x1).toBe(1);
  });
});

describe("timestamps", () => {
  it("aceita uma série monotônica dentro da duração", () => {
    expect(validateTimestampSeries(
      [{ frameNumber: 0, timestampMs: 0 }, { frameNumber: 10, timestampMs: 333 }],
      1000,
      34,
    )).toEqual([]);
  });

  it("rejeita regressão, frame fora de ordem e timestamp além da duração", () => {
    expect(validateTimestampSeries(
      [{ frameNumber: 5, timestampMs: 200 }, { frameNumber: 4, timestampMs: 100 }],
      1000,
      0,
    ).length).toBeGreaterThan(0);
    expect(validateTimestampSeries(
      [{ frameNumber: 0, timestampMs: 5000 }],
      1000,
      40,
    )).toEqual(["Timestamp 5000 excede a duração 1000."]);
  });
});

describe("transições do job", () => {
  it("permite o ciclo queued, processing, completed ou retry", () => {
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "completed")).toBe(true);
    expect(canTransition("processing", "failed")).toBe(true);
    expect(canTransition("processing", "queued")).toBe(true);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("completed", "processing")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
  });
});

describe("path traversal", () => {
  it("aceita caminho interno e rejeita escape", () => {
    expect(resolveInside("/tmp/storage", "uploads/video.mp4")).toBe("/tmp/storage/uploads/video.mp4");
    expect(() => resolveInside("/tmp/storage", "../etc/passwd")).toThrow(AppError);
    expect(() => resolveInside("/tmp/storage", "/etc/passwd")).toThrow(AppError);
    expect(() => resolveInside("/tmp/storage", "uploads/../../etc/passwd")).toThrow(AppError);
  });
});

describe("metadados de vídeo", () => {
  it("troca largura e altura quando a rotação de exibição é -90", () => {
    const parsed = parseProbe({
      format: { duration: "1.5", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
      streams: [{
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30000/1001",
        side_data_list: [{ rotation: -90 }],
      }],
    }, { maxDurationMs: 10_000 });
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1920);
    expect(parsed.rotationDegrees).toBe(270);
    expect(parsed.nominalFps).toBeCloseTo(29.97, 2);
    expect(parsed.durationMs).toBe(1500);
  });

  it("rejeita arquivo sem trilha de vídeo", () => {
    expect(() => parseProbe({
      format: { duration: "1", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
      streams: [{ codec_type: "audio" }],
    }, { maxDurationMs: 10_000 })).toThrow(/trilha de vídeo/);
  });
});
