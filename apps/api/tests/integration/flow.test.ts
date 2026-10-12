import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { createPrismaAnalysisRepository, createPrismaVideoRepository } from "../../src/repositories/prismaRepos.js";
import { createMediaProbe } from "../../src/services/mediaProbe.js";
import { processNextJob } from "../../src/workers/analysisWorker.js";
import { gapThresholdMs } from "@football-vision/shared";
import { mkdir, writeFile } from "node:fs/promises";
import type { VisionSummary } from "../../src/schemas/http.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("fluxo com PostgreSQL e ffprobe", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aceita um mp4 real, rejeita texto, persiste tracks e impede duplicata", async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "track_observations", "tracks", "artifacts", "analyses", "videos" RESTART IDENTITY CASCADE',
    );
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fv-db-"));
    const videoPath = path.join(storageRoot, "clip.mp4");
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=30:duration=1",
      "-pix_fmt", "yuv420p", "-c:v", "libx264", videoPath,
    ], { stdio: "ignore" });
    const config = loadConfig({
      STORAGE_ROOT: storageRoot,
      DATABASE_URL: databaseUrl,
      MAX_UPLOAD_BYTES: "2000000",
      WORKER_ENABLED: "false",
    });
    const videos = createPrismaVideoRepository(prisma);
    const analyses = createPrismaAnalysisRepository(prisma);
    const media = createMediaProbe(config);
    const app = await buildApp({
      config,
      videos,
      analyses,
      probe: media.probe,
      decodeCheck: media.decodeCheck,
      ffmpegAvailable: media.ffmpegAvailable,
      databaseCheck: async () => true,
      visionHealth: async () => ({
        status: "degraded",
        service: "vision",
        reachable: false,
        modelAvailable: false,
        device: null,
        deviceAvailable: false,
        ffmpeg: true,
        message: null,
      }),
      logger: false,
    });

    const text = await app.inject({
      method: "POST",
      url: "/api/v1/videos",
      ...multipart("nota.mp4", Buffer.from("nao e video")),
    });
    expect(text.statusCode).toBe(400);

    const videoBytes = execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=30:duration=1",
      "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "-pix_fmt", "yuv420p", "pipe:1",
    ]);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/v1/videos",
      ...multipart("jogo.mp4", videoBytes),
    });
    expect(uploaded.statusCode).toBe(201);
    const videoId = uploaded.json().videoId as string;
    expect(uploaded.json().durationMs).toBeGreaterThan(500);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/videos/${videoId}/analyses`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(created.statusCode).toBe(202);
    const analysisId = created.json().analysisId as string;

    await processNextJob({
      config,
      videos,
      analyses,
      now: () => new Date(),
      log: { info() {}, warn() {}, error() {} },
      visionAnalyze: async (body) => writeSummary(storageRoot, String(body.outputDir)),
    });

    const status = await app.inject({ method: "GET", url: `/api/v1/analyses/${analysisId}` });
    expect(status.json()).toMatchObject({ status: "completed", progress: 100 });
    const tracks = await app.inject({
      method: "GET",
      url: `/api/v1/analyses/${analysisId}/tracks?sort=observationCount&order=desc`,
    });
    expect(tracks.json().items[0].trackerId).toBe(4);
    const observations = await app.inject({
      method: "GET",
      url: `/api/v1/analyses/${analysisId}/tracks/4/observations?page=1&pageSize=1`,
    });
    expect(observations.json()).toMatchObject({ total: 2, items: [{ timestampMs: 0 }] });

    const track = await prisma.track.findFirstOrThrow({ where: { analysisId } });
    await expect(prisma.track.create({
      data: {
        analysisId,
        trackerId: track.trackerId,
        firstSeenMs: 0,
        lastSeenMs: 1,
        observationCount: 1,
        observedDurationMs: 1,
        averageConfidence: 0.5,
        detectionRatio: 0.5,
        gapCount: 0,
        minX1: 0,
        minY1: 0,
        maxX2: 1,
        maxY2: 1,
      },
    })).rejects.toThrow();
    await expect(prisma.trackObservation.create({
      data: {
        analysisId,
        trackId: track.id,
        trackerId: track.trackerId,
        frameNumber: 0,
        timestampMs: 0,
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        confidence: 0.2,
      },
    })).rejects.toThrow();

    const claimed = await analyses.claimNext({
      token: "outro-worker",
      staleSeconds: 30,
      maxAttempts: 2,
      now: new Date(),
    });
    expect(claimed).toBeNull();
    await app.close();
  });
});

function multipart(filename: string, content: Buffer) {
  const boundary = "----integration";
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function writeSummary(storageRoot: string, outputDir: string): Promise<VisionSummary> {
  const absolute = path.join(storageRoot, outputDir);
  await mkdir(absolute, { recursive: true });
  const samples = [{ frameNumber: 0, timestampMs: 0 }, { frameNumber: 30, timestampMs: 1000 }];
  const observations = samples.map((sample) => ({
    trackerId: 4,
    frameNumber: sample.frameNumber,
    timestampMs: sample.timestampMs,
    x1: 1,
    y1: 1,
    x2: 20,
    y2: 40,
    confidence: 0.8,
  }));
  await writeFile(path.join(absolute, "samples.jsonl"), `${samples.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await writeFile(path.join(absolute, "observations.jsonl"), `${observations.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await writeFile(path.join(absolute, "run_metadata.json"), "{}\n");
  return {
    modelName: "yolo11n.pt",
    modelSha256: null,
    trackerName: "botsort",
    device: "cpu",
    timestampMethod: "decoder_pts",
    timestampUncertaintyMs: 1,
    sampledFrameCount: 2,
    frameCount: 30,
    durationMs: 1000,
    width: 160,
    height: 120,
    rotationDegrees: 0,
    sampleFps: 3,
    confidenceThreshold: 0.25,
    gapThresholdMs: gapThresholdMs(3),
    audioPreserved: null,
    audioNote: null,
    warnings: [],
    observationsFile: `${outputDir}/observations.jsonl`,
    samplesFile: `${outputDir}/samples.jsonl`,
    annotatedVideoFile: null,
    metadataFile: `${outputDir}/run_metadata.json`,
    trackerConfig: { tracker_type: "botsort" },
    personClassNote: "classe pessoa",
  };
}
