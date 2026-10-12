import type { AnalysisStatus } from "@football-vision/shared";

const ALLOWED: Record<AnalysisStatus, readonly AnalysisStatus[]> = {
  queued: ["processing"],
  processing: ["completed", "failed", "queued"],
  completed: [],
  failed: [],
};

export function canTransition(from: AnalysisStatus, to: AnalysisStatus): boolean {
  return ALLOWED[from].includes(to);
}
