import { resolve } from "node:path";

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

export const config = {
  ytDlpBin: process.env.YT_DLP_BIN || "yt-dlp",
  ytDlpProxy: process.env.YT_DLP_PROXY || "",
  downloadDir: resolve(process.env.DOWNLOAD_DIR || "/tmp/downloader-files"),
  maxConcurrent: boundedEnv("MAX_CONCURRENT_DOWNLOADS", 2, 1, 8),
  maxQueued: boundedEnv("MAX_QUEUED_DOWNLOADS", 12, 1, 100),
  maxFileMb: boundedEnv("MAX_FILE_MB", 500, 10, 5000),
  maxDurationSeconds: boundedEnv("MAX_DURATION_SECONDS", 7200, 60, 86400),
  jobTimeoutMs: boundedEnv("JOB_TIMEOUT_SECONDS", 1800, 60, 7200) * 1000,
  fileTtlMs: boundedEnv("FILE_TTL_MINUTES", 60, 5, 1440) * 60_000,
  infoTimeoutMs: 25_000,
  trustProxyHeaders: process.env.TRUST_PROXY_HEADERS === "1",
} as const;
