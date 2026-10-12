export interface RawObservation {
  trackerId: number;
  frameNumber: number;
  timestampMs: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

export interface ComputedTrack {
  trackerId: number;
  firstSeenMs: number;
  lastSeenMs: number;
  observationCount: number;
  observedDurationMs: number;
  averageConfidence: number;
  detectionRatio: number;
  gapCount: number;
  minX1: number;
  minY1: number;
  maxX2: number;
  maxY2: number;
  observations: RawObservation[];
}

export function buildTracks(
  observations: RawObservation[],
  sampledFrameCount: number,
  gapThreshold: number,
): ComputedTrack[] {
  if (!Number.isInteger(sampledFrameCount) || sampledFrameCount < 0) {
    throw new Error("sampledFrameCount inválido.");
  }
  if (!Number.isFinite(gapThreshold) || gapThreshold < 0) {
    throw new Error("gapThreshold inválido.");
  }
  const grouped = new Map<number, RawObservation[]>();
  for (const observation of dedupe(observations)) {
    const list = grouped.get(observation.trackerId) ?? [];
    list.push(observation);
    grouped.set(observation.trackerId, list);
  }
  const tracks: ComputedTrack[] = [];
  for (const [trackerId, items] of grouped) {
    items.sort((left, right) => left.timestampMs - right.timestampMs || left.frameNumber - right.frameNumber);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      continue;
    }
    let confidenceSum = 0;
    let minX1 = Number.POSITIVE_INFINITY;
    let minY1 = Number.POSITIVE_INFINITY;
    let maxX2 = Number.NEGATIVE_INFINITY;
    let maxY2 = Number.NEGATIVE_INFINITY;
    let gapCount = 0;
    for (let index = 0; index < items.length; index += 1) {
      const current = items[index];
      if (!current) {
        continue;
      }
      confidenceSum += current.confidence;
      minX1 = Math.min(minX1, current.x1);
      minY1 = Math.min(minY1, current.y1);
      maxX2 = Math.max(maxX2, current.x2);
      maxY2 = Math.max(maxY2, current.y2);
      const previous = items[index - 1];
      if (previous && current.timestampMs - previous.timestampMs > gapThreshold) {
        gapCount += 1;
      }
    }
    tracks.push({
      trackerId,
      firstSeenMs: first.timestampMs,
      lastSeenMs: last.timestampMs,
      observationCount: items.length,
      observedDurationMs: last.timestampMs - first.timestampMs,
      averageConfidence: Number((confidenceSum / items.length).toFixed(6)),
      detectionRatio: sampledFrameCount === 0 ? 0 : items.length / sampledFrameCount,
      gapCount,
      minX1,
      minY1,
      maxX2,
      maxY2,
      observations: items,
    });
  }
  tracks.sort((left, right) => left.trackerId - right.trackerId);
  return tracks;
}

function dedupe(observations: RawObservation[]): RawObservation[] {
  const best = new Map<string, RawObservation>();
  for (const observation of observations) {
    validateObservation(observation);
    const key = `${observation.trackerId}:${observation.frameNumber}`;
    const current = best.get(key);
    if (!current || observation.confidence > current.confidence) {
      best.set(key, observation);
    }
  }
  return [...best.values()];
}

export function validateObservation(observation: RawObservation): void {
  if (!Number.isInteger(observation.trackerId) || observation.trackerId < 0) {
    throw new Error("trackerId inválido.");
  }
  if (!Number.isInteger(observation.frameNumber) || observation.frameNumber < 0) {
    throw new Error("frameNumber inválido.");
  }
  if (!Number.isInteger(observation.timestampMs) || observation.timestampMs < 0) {
    throw new Error("timestampMs inválido.");
  }
  for (const key of ["x1", "y1", "x2", "y2", "confidence"] as const) {
    if (!Number.isFinite(observation[key])) {
      throw new Error(`${key} inválido.`);
    }
  }
  if (observation.x2 < observation.x1 || observation.y2 < observation.y1) {
    throw new Error("Bounding box inválida.");
  }
  if (observation.confidence < 0 || observation.confidence > 1) {
    throw new Error("Confiança inválida.");
  }
}
