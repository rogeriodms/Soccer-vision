import { AppError } from "../lib/errors.js";
import type { AnalysisRecord, AnalysisRepository } from "../repositories/types.js";

export async function requireAnalysis(analyses: AnalysisRepository, analysisId: string): Promise<AnalysisRecord> {
  const analysis = await analyses.findById(analysisId);
  if (!analysis) {
    throw new AppError(404, "analysis_not_found", "Análise não encontrada.");
  }
  return analysis;
}

export function requireCompleted(analysis: AnalysisRecord): void {
  if (analysis.status !== "completed") {
    throw new AppError(409, "results_not_ready", "A análise ainda não foi concluída.");
  }
}
