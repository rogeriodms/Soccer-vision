import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_SAMPLE_FPS,
  DEFAULT_TRACKER,
  MAX_CONFIDENCE_THRESHOLD,
  MAX_SAMPLE_FPS,
  MIN_CONFIDENCE_THRESHOLD,
  MIN_SAMPLE_FPS,
  TRACKERS,
} from "@football-vision/shared";
import { z } from "zod";

export const analysisConfigSchema = z
  .object({
    sampleFps: z.number().min(MIN_SAMPLE_FPS).max(MAX_SAMPLE_FPS).default(DEFAULT_SAMPLE_FPS),
    confidenceThreshold: z
      .number()
      .min(MIN_CONFIDENCE_THRESHOLD)
      .max(MAX_CONFIDENCE_THRESHOLD)
      .default(DEFAULT_CONFIDENCE_THRESHOLD),
    tracker: z.enum(TRACKERS).default(DEFAULT_TRACKER),
    generateAnnotatedVideo: z.boolean().default(false),
  })
  .strict();

export type AnalysisConfig = z.infer<typeof analysisConfigSchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const trackQuerySchema = pageQuerySchema.extend({
  sort: z
    .enum([
      "trackerId",
      "firstSeenMs",
      "lastSeenMs",
      "observationCount",
      "averageConfidence",
      "observedDurationMs",
      "detectionRatio",
      "gapCount",
    ])
    .default("trackerId"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export type TrackQuery = z.infer<typeof trackQuerySchema>;

export const visionSummarySchema = z
  .object({
    modelName: z.string().min(1),
    modelSha256: z.string().nullable(),
    trackerName: z.enum(TRACKERS),
    device: z.string().min(1),
    timestampMethod: z.enum(["decoder_pts", "nominal_fps_fallback"]),
    timestampUncertaintyMs: z.number().nonnegative(),
    sampledFrameCount: z.number().int().nonnegative(),
    frameCount: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    rotationDegrees: z.number().int(),
    sampleFps: z.number().positive(),
    confidenceThreshold: z.number(),
    gapThresholdMs: z.number().nonnegative(),
    audioPreserved: z.boolean().nullable(),
    audioNote: z.string().nullable(),
    warnings: z.array(z.string()),
    observationsFile: z.string().min(1),
    samplesFile: z.string().min(1),
    annotatedVideoFile: z.string().nullable(),
    metadataFile: z.string().min(1),
    trackerConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    personClassNote: z.string(),
  })
  .strict();

export type VisionSummary = z.infer<typeof visionSummarySchema>;

export const observationLineSchema = z
  .object({
    trackerId: z.number().int().nonnegative(),
    frameNumber: z.number().int().nonnegative(),
    timestampMs: z.number().int().nonnegative(),
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const sampleLineSchema = z
  .object({
    frameNumber: z.number().int().nonnegative(),
    timestampMs: z.number().int().nonnegative(),
  })
  .strict();

export const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
