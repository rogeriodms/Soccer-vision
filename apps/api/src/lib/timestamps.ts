export interface TimedFrame {
  frameNumber: number;
  timestampMs: number;
}

export function validateTimestampSeries(samples: TimedFrame[], durationMs: number, toleranceMs: number): string[] {
  const issues: string[] = [];
  let previousFrame = -1;
  let previousTimestamp = -1;
  for (const sample of samples) {
    if (!Number.isInteger(sample.frameNumber) || sample.frameNumber <= previousFrame) {
      issues.push(`Frame fora de ordem: ${sample.frameNumber}.`);
    }
    if (!Number.isInteger(sample.timestampMs) || sample.timestampMs < 0) {
      issues.push(`Timestamp inválido no frame ${sample.frameNumber}.`);
    } else if (sample.timestampMs < previousTimestamp) {
      issues.push(`Timestamp regressivo no frame ${sample.frameNumber}.`);
    } else if (sample.timestampMs > durationMs + toleranceMs) {
      issues.push(`Timestamp ${sample.timestampMs} excede a duração ${durationMs}.`);
    }
    previousFrame = sample.frameNumber;
    previousTimestamp = Math.max(previousTimestamp, sample.timestampMs);
  }
  return issues;
}
