import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import { createTestApp, multipart, sampleProbe } from "../helpers.js";

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("uploads", () => {
  it("rejeita conteúdo que não passa na validação do vídeo", async () => {
    const { app } = await createTestApp({}, async () => {
      throw new AppError(400, "invalid_video", "O arquivo não é um vídeo MP4 ou MOV válido.");
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/videos",
      ...multipart("clip.mp4", Buffer.from("isto nao e um video")),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_video" });
  });

  it("rejeita arquivo maior que o limite configurado", async () => {
    const { app } = await createTestApp({ maxUploadBytes: 32 });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/videos",
      ...multipart("grande.mp4", Buffer.alloc(80, 1)),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toBe("file_too_large");
  });

  it("não usa o nome enviado como caminho de armazenamento", async () => {
    const { app, videos } = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/videos",
      ...multipart("../../etc/passwd.mp4", Buffer.from("fake-bytes")),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.originalName).not.toContain("..");
    const stored = await videos.findById(body.videoId);
    expect(stored?.storagePath.startsWith("uploads/")).toBe(true);
    expect(stored?.storagePath).not.toContain("..");
    expect(body.storagePath).toBeUndefined();
  });
});

describe("criação de análise", () => {
  it("recusa parâmetros inválidos e aceita o corpo vazio com defaults", async () => {
    const { app, videos } = await createTestApp();
    apps.push(app);
    const video = await videos.create({
      id: "11111111-1111-4111-8111-111111111111",
      originalName: "jogo.mp4",
      storagePath: "uploads/jogo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 10,
      durationMs: 1000,
      width: 320,
      height: 240,
      nominalFps: 30,
      createdAt: new Date("2026-10-12T00:00:00.000Z"),
    });
    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/videos/${video.id}/analyses`,
      headers: { "content-type": "application/json" },
      payload: { sampleFps: -1 },
    });
    expect(invalid.statusCode).toBe(400);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/videos/${video.id}/analyses`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      status: "queued",
      configuration: { sampleFps: 3, confidenceThreshold: 0.25, tracker: "botsort", generateAnnotatedVideo: false },
    });
  });
});

describe("artefatos", () => {
  it("não abre caminho fora do armazenamento", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "fv-artifact-"));
    const { app, analyses } = await createTestApp({ storageRoot });
    apps.push(app);
    const analysis = await analyses.create({
      id: "22222222-2222-4222-8222-222222222222",
      videoId: "11111111-1111-4111-8111-111111111111",
      configuration: {
        sampleFps: 3,
        confidenceThreshold: 0.25,
        tracker: "botsort",
        generateAnnotatedVideo: false,
      },
      now: new Date("2026-10-12T00:00:00.000Z"),
    });
    const stored = analyses.items.get(analysis.id);
    if (!stored) {
      throw new Error("análise não criada");
    }
    stored.status = "completed";
    analyses.artifacts.set(`${analysis.id}:run_metadata`, {
      id: "33333333-3333-4333-8333-333333333333",
      analysisId: analysis.id,
      kind: "run_metadata",
      relativePath: "../../etc/passwd",
      mimeType: "application/json",
      sizeBytes: 10,
      createdAt: new Date(),
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/analyses/${analysis.id}/artifacts/run_metadata`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_path");
    await writeFile(path.join(storageRoot, "note.txt"), "ok");
  });

  it("rejeita kind com traversal na URL", async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/analyses/22222222-2222-4222-8222-222222222222/artifacts/..%2F..%2Fetc%2Fpasswd",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});

describe("probe de exemplo", () => {
  it("mantém o formato do probe de teste", () => {
    expect(sampleProbe().extension).toBe(".mp4");
  });
});
