import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gapThresholdMs } from "@football-vision/shared";
import { loadConfig } from "../../src/config/env.js";
import type { AnalysisRecord } from "../../src/repositories/types.js";
import type { VisionSummary } from "../../src/schemas/http.js";
import { VisionRequestError } from "../../src/services/visionClient.js";
import { processClaimedJob, processNextJob } from "../../src/workers/analysisWorker.js";
import { MemoryAnalyses, MemoryVideos } from "../fakes/memory.js";

const silentLog = { info() {}, warn() {}, error() {} };

describe("worker", () => {
  it("vai de queued para completed e não duplica ao repetir a gravação", async () => {
    const { videos, analyses, deps, videoId } = await setup();
    const processed = await processNextJob({
      ...deps,
      visionAnalyze: async (body) => writeSummary(deps.config.storageRoot, String(body.outputDir), false),
    });
    expect(processed).toBe(true);
    const analysis = [...analyses.items.values()][0];
    expect(analysis?.status).toBe("completed");
    expect(analysis?.modelName).toBe("yolo11n.pt");
    const tracks = await analyses.listTracks(analysis!.id, {
      page: 1,
      pageSize: 50,
      sort: "trackerId",
      order: "asc",
    });
    expect(tracks.total).toBe(1);
    expect(tracks.items[0]).toMatchObject({ observationCount: 2, gapCount: 1, detectionRatio: 1 });
    const observations = await analyses.listObservations(analysis!.id, 4, { page: 1, pageSize: 1 });
    expect(observations?.total).toBe(2);
    expect(observations?.items.map((item) => item.timestampMs)).toEqual([0]);
    const secondPage = await analyses.listObservations(analysis!.id, 4, { page: 2, pageSize: 1 });
    expect(secondPage?.items.map((item) => item.timestampMs)).toEqual([2000]);
    const repeated = await analyses.saveResults(analysis!.id, "token-velho", emptyPayload(), new Date());
    expect(repeated).toBe("lost_claim");
    expect((await analyses.listObservations(analysis!.id, 4, { page: 1, pageSize: 10 }))?.total).toBe(2);
    expect(videos.items.get(videoId)?.originalName).toBe("jogo.mp4");
  });

  it("substitui o resultado de uma nova tentativa em vez de somar observações", async () => {
    const { analyses, deps } = await setup();
    const job = await analyses.claimNext({ token: "claim-1", staleSeconds: 900, maxAttempts: 2, now: new Date("2026-10-12T00:00:01.000Z") });
    await processClaimedJob(job!, {
      ...deps,
      visionAnalyze: async (body) => writeSummary(deps.config.storageRoot, String(body.outputDir), false),
    });
    const analysis = [...analyses.items.values()][0]!;
    analysis.status = "processing";
    analysis.claimToken = "claim-2";
    await processClaimedJob(analysis, {
      ...deps,
      visionAnalyze: async (body) => writeSummary(deps.config.storageRoot, String(body.outputDir), true),
    });
    const observations = await analyses.listObservations(analysis.id, 4, { page: 1, pageSize: 10 });
    expect(observations?.total).toBe(1);
  });

  it("reagenda falha transitória e falha de vez quando as tentativas acabam", async () => {
    const { analyses, deps } = await setup();
    deps.config.workerMaxAttempts = 2;
    const job = await analyses.claimNext({ token: "claim-1", staleSeconds: 900, maxAttempts: 2, now: new Date("2026-10-12T00:00:01.000Z") });
    await processClaimedJob(job!, {
      ...deps,
      visionAnalyze: async () => {
        throw new VisionRequestError("VISION_UNAVAILABLE", "Serviço de visão indisponível.", true);
      },
    });
    expect([...analyses.items.values()][0]?.status).toBe("queued");
    expect([...analyses.items.values()][0]?.currentStage).toBe("retry_scheduled");
    const again = await analyses.claimNext({
      token: "claim-2",
      staleSeconds: 900,
      maxAttempts: 2,
      now: new Date("2026-10-12T00:10:00.000Z"),
    });
    await processClaimedJob(again!, {
      ...deps,
      visionAnalyze: async () => {
        throw new VisionRequestError("VISION_FAILED", "traceback interno", false);
      },
    });
    const failed = [...analyses.items.values()][0];
    expect(failed?.status).toBe("failed");
    expect(failed?.errorMessage).not.toMatch(/traceback/i);
  });

  it("não tenta de novo quando os pesos não existem", async () => {
    const { analyses, deps } = await setup();
    const job = await analyses.claimNext({ token: "claim-1", staleSeconds: 900, maxAttempts: 2, now: new Date("2026-10-12T00:00:01.000Z") });
    await processClaimedJob(job!, {
      ...deps,
      visionAnalyze: async () => {
        throw new VisionRequestError("MODEL_WEIGHTS_MISSING", "Pesos YOLO 'yolo11n.pt' não encontrados.", false, 409);
      },
    });
    expect([...analyses.items.values()][0]?.status).toBe("failed");
    expect([...analyses.items.values()][0]?.errorCode).toBe("MODEL_WEIGHTS_MISSING");
  });
});

async function setup() {
  const storageRoot = path.join("/tmp", `fv-worker-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(storageRoot, { recursive: true });
  const config = loadConfig({ STORAGE_ROOT: storageRoot, WORKER_ENABLED: "false", SIGNIFICANT_GAP_FACTOR: "2" });
  const videos = new MemoryVideos();
  const analyses = new MemoryAnalyses();
  const videoId = "11111111-1111-4111-8111-111111111111";
  await videos.create({
    id: videoId,
    originalName: "jogo.mp4",
    storagePath: "uploads/jogo.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    durationMs: 3000,
    width: 320,
    height: 240,
    nominalFps: 30,
    createdAt: new Date("2026-10-12T00:00:00.000Z"),
  });
  await analyses.create({
    id: "22222222-2222-4222-8222-222222222222",
    videoId,
    configuration: {
      sampleFps: 3,
      confidenceThreshold: 0.25,
      tracker: "botsort",
      generateAnnotatedVideo: false,
    },
    now: new Date("2026-10-12T00:00:00.000Z"),
  });
  return {
    videos,
    analyses,
    videoId,
    deps: { config, videos, analyses, now: () => new Date("2026-10-12T00:00:02.000Z"), log: silentLog, visionAnalyze: async () => { throw new Error("não configurado"); } },
  };
}

async function writeSummary(storageRoot: string, outputDir: string, single: boolean): Promise<VisionSummary> {
  const absolute = path.join(storageRoot, outputDir);
  await mkdir(absolute, { recursive: true });
  const samples = single
    ? [{ frameNumber: 0, timestampMs: 0 }]
    : [{ frameNumber: 0, timestampMs: 0 }, { frameNumber: 60, timestampMs: 2000 }];
  const observations = single
    ? [observation(0, 0)]
    : [observation(0, 0), observation(60, 2000)];
  await writeFile(path.join(absolute, "samples.jsonl"), `${samples.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await writeFile(path.join(absolute, "observations.jsonl"), `${observations.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await writeFile(path.join(absolute, "run_metadata.json"), "{}\n");
  return {
    modelName: "yolo11n.pt",
    modelSha256: "abc",
    trackerName: "botsort",
    device: "cpu",
    timestampMethod: "decoder_pts",
    timestampUncertaintyMs: 1,
    sampledFrameCount: samples.length,
    frameCount: 90,
    durationMs: 3000,
    width: 320,
    height: 240,
    rotationDegrees: 0,
    sampleFps: 3,
    confidenceThreshold: 0.25,
    gapThresholdMs: gapThresholdMs(3),
    audioPreserved: null,
    audioNote: null,
    warnings: ["A detecção usa a classe pessoa."],
    observationsFile: path.posix.join(outputDir, "observations.jsonl"),
    samplesFile: path.posix.join(outputDir, "samples.jsonl"),
    annotatedVideoFile: null,
    metadataFile: path.posix.join(outputDir, "run_metadata.json"),
    trackerConfig: { tracker_type: "botsort", track_buffer: 9 },
    personClassNote: "A detecção usa a classe pessoa do COCO.",
  };
}

function observation(frameNumber: number, timestampMs: number) {
  return { trackerId: 4, frameNumber, timestampMs, x1: 10, y1: 10, x2: 40, y2: 80, confidence: 0.8 };
}

function emptyPayload(): Parameters<MemoryAnalyses["saveResults"]>[2] {
  return {
    modelName: "yolo11n.pt",
    trackerName: "botsort",
    resultSummary: {} as AnalysisRecord["resultSummary"] & object,
    tracks: [],
    artifacts: [],
  };
}
