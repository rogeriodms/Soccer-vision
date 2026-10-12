-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "analysis_status" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "nominal_fps" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "status" "analysis_status" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "current_stage" TEXT,
    "model_name" TEXT,
    "tracker_name" TEXT,
    "configuration" JSONB NOT NULL,
    "result_summary" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "tracker_id" INTEGER NOT NULL,
    "first_seen_ms" INTEGER NOT NULL,
    "last_seen_ms" INTEGER NOT NULL,
    "observation_count" INTEGER NOT NULL,
    "observed_duration_ms" INTEGER NOT NULL,
    "average_confidence" DOUBLE PRECISION NOT NULL,
    "detection_ratio" DOUBLE PRECISION NOT NULL,
    "gap_count" INTEGER NOT NULL,
    "min_x1" DOUBLE PRECISION NOT NULL,
    "min_y1" DOUBLE PRECISION NOT NULL,
    "max_x2" DOUBLE PRECISION NOT NULL,
    "max_y2" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_observations" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "tracker_id" INTEGER NOT NULL,
    "frame_number" INTEGER NOT NULL,
    "timestamp_ms" INTEGER NOT NULL,
    "x1" DOUBLE PRECISION NOT NULL,
    "y1" DOUBLE PRECISION NOT NULL,
    "x2" DOUBLE PRECISION NOT NULL,
    "y2" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "track_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analyses_status_available_at_created_at_idx" ON "analyses"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "analyses_video_id_idx" ON "analyses"("video_id");

-- CreateIndex
CREATE INDEX "tracks_analysis_id_idx" ON "tracks"("analysis_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_analysis_id_tracker_id_key" ON "tracks"("analysis_id", "tracker_id");

-- CreateIndex
CREATE INDEX "track_observations_analysis_id_timestamp_ms_idx" ON "track_observations"("analysis_id", "timestamp_ms");

-- CreateIndex
CREATE INDEX "track_observations_track_id_timestamp_ms_idx" ON "track_observations"("track_id", "timestamp_ms");

-- CreateIndex
CREATE UNIQUE INDEX "track_observations_analysis_id_track_id_frame_number_key" ON "track_observations"("analysis_id", "track_id", "frame_number");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_analysis_id_kind_key" ON "artifacts"("analysis_id", "kind");

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_observations" ADD CONSTRAINT "track_observations_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_observations" ADD CONSTRAINT "track_observations_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

