export type DownloadProgress = {
  percent: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
};

function numeric(value: string): number | null {
  if (value === "NA" || value === "None" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// yt-dlp emits one line per progress report with our --progress-template.
// Prefer downloaded/total byte counters to localized percent strings.
export function parseProgressLine(line: string): DownloadProgress | null {
  const index = line.indexOf("DL|");
  if (index < 0) return null;
  const parts = line.slice(index + 3).trim().split("|");
  if (parts.length < 5) return null;

  const downloaded = numeric(parts[0]);
  const total = numeric(parts[1]) ?? numeric(parts[2]);
  const speedBytesPerSecond = numeric(parts[3]);
  const etaSeconds = numeric(parts[4]);
  const percent = downloaded !== null && total !== null && total > 0
    ? Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)))
    : null;
  return { percent, speedBytesPerSecond, etaSeconds };
}
