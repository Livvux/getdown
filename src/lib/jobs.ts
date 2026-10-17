import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { config } from "./config";
import { getOutputFile, runYtDlp } from "./yt-dlp";
import { InputError, safeFilename, type DownloadOptions } from "./validation";

export type JobStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

type Job = {
  id: string;
  options: DownloadOptions;
  status: JobStatus;
  percent: number;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  filePath: string | null;
  fileBytes: number | null;
  fileName: string | null;
  child: ChildProcessWithoutNullStreams | null;
};

type ManagerState = {
  jobs: Map<string, Job>;
  queue: string[];
  active: number;
  cleanupStarted: boolean;
};

type PublicJob = {
  id: string;
  status: JobStatus;
  percent: number;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  error: string | null;
  createdAt: number;
  fileName: string | null;
  fileBytes: number | null;
  fileUrl: string | null;
};

const scope = globalThis as typeof globalThis & { __downloaderState?: ManagerState };
const state: ManagerState = scope.__downloaderState ?? {
  jobs: new Map<string, Job>(),
  queue: [],
  active: 0,
  cleanupStarted: false,
};
scope.__downloaderState = state;

function publicJob(job: Job): PublicJob {
  return {
    id: job.id,
    status: job.status,
    percent: job.percent,
    speedBytesPerSecond: job.speedBytesPerSecond,
    etaSeconds: job.etaSeconds,
    error: job.error,
    createdAt: job.createdAt,
    fileName: job.fileName,
    fileBytes: job.fileBytes,
    fileUrl: job.status === "completed" ? "/api/jobs/" + job.id + "/file" : null,
  };
}

async function removeJobFiles(id: string): Promise<void> {
  try {
    const files = await readdir(config.downloadDir);
    await Promise.all(files.filter((name) => name.startsWith(id + "."))
      .map((name) => unlink(join(config.downloadDir, name)).catch(() => undefined)));
  } catch {
    // Directory may not exist on a fresh instance.
  }
}

async function cleanupExpired(): Promise<void> {
  const now = Date.now();
  for (const [id, job] of state.jobs) {
    if (["queued", "downloading", "processing"].includes(job.status)) continue;
    if (now - (job.completedAt || job.createdAt) < config.fileTtlMs) continue;
    state.jobs.delete(id);
    await removeJobFiles(id);
  }

  // Remove orphaned files left behind by restarts. Keep files belonging to
  // active or recently completed jobs; only touch our UUID-prefixed outputs.
  try {
    const files = await readdir(config.downloadDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./.test(file.name)) {
        continue;
      }
      if (state.jobs.has(file.name.slice(0, 36))) continue;
      const path = join(config.downloadDir, file.name);
      try {
        const details = await stat(path);
        if (now - details.mtimeMs >= config.fileTtlMs) {
          await unlink(path);
        }
      } catch {
        // Another worker/cleanup invocation may have removed this file.
      }
    }
  } catch {
    // No download directory on a fresh instance.
  }
}

function setupCleanup(): void {
  if (state.cleanupStarted) return;
  state.cleanupStarted = true;
  const handle = setInterval(() => void cleanupExpired(), 5 * 60_000);
  handle.unref();
  void cleanupExpired();
}

export function startCleanup(): void {
  setupCleanup();
}

function wasCancelled(job: Job): boolean {
  return job.status === "cancelled";
}

async function run(job: Job): Promise<void> {
  try {
    await mkdir(config.downloadDir, { recursive: true });
    if (wasCancelled(job)) return;

    await runYtDlp(job.options, job.id, {
      onChild: (child) => {
        job.child = child;
        if (job.status === "cancelled") child.kill("SIGTERM");
      },
      onProgress: (progress) => {
        if (wasCancelled(job)) return;
        if (progress.percent !== null) {
          // A download can have multiple streams; never report 100% before muxing.
          job.percent = Math.max(job.percent, Math.min(94, Math.floor(progress.percent * 0.94)));
        }
        job.speedBytesPerSecond = progress.speedBytesPerSecond;
        job.etaSeconds = progress.etaSeconds;
      },
      onProcessing: () => {
        if (job.status !== "cancelled") {
          job.status = "processing";
          job.percent = Math.max(job.percent, 95);
        }
      },
    });

    if (wasCancelled(job)) return;
    job.status = "processing";
    job.percent = Math.max(job.percent, 95);
    const output = await getOutputFile(job.id, job.options.format);
    if (wasCancelled(job)) return;
    job.filePath = output.path;
    job.fileBytes = output.bytes;
    job.fileName = safeFilename(job.options.title) + "." + output.extension;
    job.percent = 100;
    job.status = "completed";
    job.completedAt = Date.now();
  } catch (error) {
    if (job.status !== "cancelled") {
      job.status = "failed";
      job.error = error instanceof InputError
        ? error.message
        : "This download could not be completed.";
      job.completedAt = Date.now();
    }
  } finally {
    job.child = null;
    if (job.status !== "completed") await removeJobFiles(job.id);
  }
}

function pump(): void {
  while (state.active < config.maxConcurrent && state.queue.length > 0) {
    const id = state.queue.shift();
    const job = id ? state.jobs.get(id) : null;
    if (!job || job.status !== "queued") continue;
    state.active += 1;
    job.status = "downloading";
    void run(job).finally(() => {
      state.active -= 1;
      pump();
    });
  }
}

export function createJob(options: DownloadOptions): PublicJob {
  setupCleanup();
  if (state.queue.length >= config.maxQueued) {
    throw new InputError("The queue is full. Please try again soon.", 503);
  }
  const job: Job = {
    id: randomUUID(),
    options,
    status: "queued",
    percent: 0,
    speedBytesPerSecond: null,
    etaSeconds: null,
    error: null,
    createdAt: Date.now(),
    completedAt: null,
    filePath: null,
    fileBytes: null,
    fileName: null,
    child: null,
  };
  state.jobs.set(job.id, job);
  state.queue.push(job.id);
  pump();
  return publicJob(job);
}

export function findJob(id: string): PublicJob | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const job = state.jobs.get(id);
  return job ? publicJob(job) : null;
}

export function findCompletedFile(id: string): { path: string; name: string; bytes: number } | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const job = state.jobs.get(id);
  if (!job || job.status !== "completed" || !job.filePath || !job.fileName ||
      !job.fileBytes || basename(job.filePath) !== job.id + "." + job.options.format) {
    return null;
  }
  return { path: job.filePath, name: job.fileName, bytes: job.fileBytes };
}

export function cancelJob(id: string): PublicJob | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const job = state.jobs.get(id);
  if (!job) return null;
  if (job.status === "queued" || job.status === "downloading" || job.status === "processing") {
    job.status = "cancelled";
    job.error = null;
    job.completedAt = Date.now();
    state.queue = state.queue.filter((item) => item !== id);
    if (job.child) {
      const child = job.child;
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
      timeout.unref();
    }
  }
  return publicJob(job);
}
