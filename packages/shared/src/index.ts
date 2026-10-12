export const ANALYSIS_STATUSES = ["queued", "processing", "completed", "failed"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const TRACKERS = ["botsort", "bytetrack"] as const;
export type TrackerName = (typeof TRACKERS)[number];

export const DEFAULT_SAMPLE_FPS = 3;
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.25;
export const DEFAULT_TRACKER: TrackerName = "botsort";
export const MIN_SAMPLE_FPS = 0.5;
export const MAX_SAMPLE_FPS = 15;
export const MIN_CONFIDENCE_THRESHOLD = 0.01;
export const MAX_CONFIDENCE_THRESHOLD = 0.95;
export const SIGNIFICANT_GAP_FACTOR = 2;

export const METRICS_DISCLAIMER =
  "Métricas preliminares. Dependem da qualidade do vídeo, da amostragem e do rastreamento. A duração observada é só o intervalo entre a primeira e a última detecção deste track, não o tempo de jogo. Um track não comprova que se trata do mesmo atleta durante toda a partida.";

export const PERSON_CLASS_NOTE =
  "A detecção usa a classe pessoa do COCO. Árbitros, comissão técnica, gandulas e espectadores também podem gerar tracks.";

export const DETECTION_RATIO_EXPLANATION =
  "observationCount dividido pelo número de frames amostrados enviados ao detector nesta análise. O denominador não é o total de frames do arquivo nem o tempo de partida.";

export const GAP_DEFINITION =
  "Uma lacuna conta quando o intervalo entre observações consecutivas do mesmo track é maior que 2 períodos de amostragem mais 25% de um período, para tolerar arredondamento.";

export function gapThresholdMs(sampleFps: number, factor = SIGNIFICANT_GAP_FACTOR): number {
  if (!(sampleFps > 0) || !(factor > 0)) {
    throw new Error("Parâmetros de lacuna inválidos.");
  }
  const interval = 1000 / sampleFps;
  return interval * factor + interval * 0.25;
}
