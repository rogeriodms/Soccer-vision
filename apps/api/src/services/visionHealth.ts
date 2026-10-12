export interface VisionHealth {
  status: "ok" | "degraded";
  service: "vision";
  reachable: boolean;
  modelAvailable: boolean;
  device: string | null;
  deviceAvailable: boolean;
  ffmpeg: boolean;
  message: string | null;
}
