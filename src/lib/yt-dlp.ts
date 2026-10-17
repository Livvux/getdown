import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { config } from "./config";
import { parseProgressLine, type DownloadProgress } from "./progress";
import { InputError, type DownloadOptions } from "./validation";

const execFileAsync = promisify(execFile);

export type MediaPreview = {
  title: string;
  creator: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  platform: string;
  resolutions: number[];
};

type MediaInfo = {
  _type?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  extractor_key?: string;
  formats?: Array<{ height?: number; vcodec?: string }>;
  entries?: unknown[];
  is_live?: boolean;
};

function subprocessEnvironment(): NodeJS.ProcessEnv {
  // Intentionally do not forward secrets, proxy variables, or arbitrary env.
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    LANG: "C.UTF-8",
    PYTHONIOENCODING: "utf-8",
  };
}

function normalText(value: unknown, fallback: string, max = 160): string {
  return typeof value === "string" && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
    : fallback;
}

export async function inspectMedia(url: string): Promise<MediaPreview> {
  let info: MediaInfo;
  try {
    const { stdout } = await execFileAsync(
      config.ytDlpBin,
      [
        "--no-config", "--no-playlist", "--skip-download",
        "--dump-single-json", "--socket-timeout", "12", "--retries", "1",
        "--", url,
      ],
      {
        timeout: config.infoTimeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: subprocessEnvironment(),
      },
    );
    info = JSON.parse(stdout) as MediaInfo;
  } catch {
    throw new InputError(
      "Could not inspect this URL. It may be private, unavailable, restricted, or unsupported.",
      422,
    );
  }

  if (info._type === "playlist" || Array.isArray(info.entries)) {
    throw new InputError("Playlists are not supported. Paste a link to one video or audio track.", 422);
  }
  if (info.is_live) {
    throw new InputError("Live streams are not supported yet.", 422);
  }
  if (
    typeof info.duration === "number" &&
    info.duration > config.maxDurationSeconds
  ) {
    throw new InputError("This media is longer than the server's duration limit.", 413);
  }
  const resolutions = [...new Set(
    (info.formats || [])
      .map((format) => format.height)
      .filter((height): height is number =>
        typeof height === "number" && height >= 144 && height <= 4320),
  )].sort((a, b) => b - a);

  let thumbnail: string | null = null;
  if (typeof info.thumbnail === "string" && info.thumbnail.length < 2048) {
    try {
      const parsed = new URL(info.thumbnail);
      if (parsed.protocol === "https:") thumbnail = parsed.toString();
    } catch {
      // No preview image.
    }
  }

  return {
    title: normalText(info.title, "Untitled media"),
    creator: normalText(info.uploader || info.channel || info.artist, "", 100) || null,
    durationSeconds: typeof info.duration === "number" && info.duration >= 0
      ? Math.round(info.duration)
      : null,
    thumbnail,
    platform: normalText(info.extractor_key, new URL(url).hostname, 50),
    resolutions,
  };
}

export function buildDownloadArgs(options: DownloadOptions, id: string): string[] {
  const args = [
    "--no-config", "--no-playlist", "--no-overwrites", "--no-mtime",
    "--socket-timeout", "20", "--retries", "3", "--fragment-retries", "3",
    "--concurrent-fragments", "2", "--max-filesize", String(config.maxFileMb) + "M",
    "--match-filter", "duration <=? " + config.maxDurationSeconds,
    "--newline", "--progress", "--progress-delta", "0.5",
    "--progress-template",
    "download:DL|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
    "--output", join(config.downloadDir, id + ".%(ext)s"),
  ];

  if (options.format === "mp4") {
    const height = options.quality === "best" ? "" : "[height<=" + options.quality + "]";
    const expression = [
      "bv[ext=mp4]" + height + "+ba[ext=m4a]",
      "b[ext=mp4]" + height,
      "bv" + height + "+ba",
      "b" + height,
    ].join("/");
    args.push("-f", expression, "--merge-output-format", "mp4", "--remux-video", "mp4");
  } else {
    args.push("-f", "bestaudio/best", "--extract-audio", "--audio-format", options.format);
    args.push("--audio-quality", "0");
  }
  // Double dash prevents a URL starting with a dash from becoming a CLI option.
  args.push("--", options.url);
  return args;
}

export type DownloadHandlers = {
  onProgress: (progress: DownloadProgress) => void;
  onProcessing: () => void;
  onChild: (child: ChildProcessWithoutNullStreams) => void;
};

export async function runYtDlp(
  options: DownloadOptions,
  id: string,
  handlers: DownloadHandlers,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.ytDlpBin, buildDownloadArgs(options, id), {
      shell: false,
      windowsHide: true,
      env: subprocessEnvironment(),
    });
    child.stdin.end();
    handlers.onChild(child);
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const hardKill = setTimeout(() => child.kill("SIGKILL"), 3_000);
      hardKill.unref();
    }, config.jobTimeoutMs);
    timeout.unref();

    const output = createInterface({ input: child.stdout });
    output.on("line", (line) => {
      const progress = parseProgressLine(line);
      if (progress) handlers.onProgress(progress);
      if (
        line.includes("[Merger]") ||
        line.includes("[ExtractAudio]") ||
        line.includes("[VideoRemuxer]")
      ) handlers.onProcessing();
    });

    // Consume stderr so subprocess pipes cannot fill and deadlock.
    child.stderr.resume();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      output.close();
      if (error) reject(error);
      else resolve();
    };
    child.once("error", () => finish(new InputError(
      "The downloader could not start. Check that yt-dlp is installed.",
      503,
    )));
    child.once("close", (code) => {
      if (timedOut) {
        finish(new InputError("The download exceeded the server time limit.", 504));
      } else if (code !== 0) {
        finish(new InputError(
          "Download failed. The media may be restricted or the requested format unavailable.",
          422,
        ));
      } else finish();
    });
  });
}

export async function getOutputFile(
  id: string,
  format: DownloadOptions["format"],
): Promise<{ path: string; bytes: number; extension: string }> {
  const directory = await readdir(config.downloadDir);
  const wanted = format === "mp4" ? [".mp4"] : ["." + format];
  const candidates = directory.filter((name) =>
    name.startsWith(id + ".") && wanted.some((extension) => name.endsWith(extension)),
  );
  for (const name of candidates) {
    const path = join(config.downloadDir, name);
    const file = await stat(path);
    if (!file.isFile() || file.size < 1) continue;
    if (file.size > config.maxFileMb * 1024 * 1024) {
      throw new InputError("The resulting file exceeded the server size limit.", 413);
    }
    return { path, bytes: file.size, extension: format };
  }
  throw new InputError("The requested output format could not be produced.", 422);
}

export async function checkBinary(binary: string): Promise<boolean> {
  try {
    await execFileAsync(binary, ["-version"], {
      timeout: 4_000,
      maxBuffer: 64 * 1024,
      env: subprocessEnvironment(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkDependencies(): Promise<{ ytDlp: boolean; ffmpeg: boolean }> {
  const [ytDlp, ffmpeg] = await Promise.all([
    execFileAsync(config.ytDlpBin, ["--version"], {
      timeout: 4_000,
      maxBuffer: 64 * 1024,
      env: subprocessEnvironment(),
    }).then(() => true, () => false),
    checkBinary("ffmpeg"),
  ]);
  return { ytDlp, ffmpeg };
}
