"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2,
  Clipboard, Clock3, FileVideo2, Github, Globe2, Headphones,
  Link2, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck,
  Sparkles, X,
} from "lucide-react";

type Preview = {
  title: string;
  creator: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  platform: string;
  resolutions: number[];
};

type Format = "mp4" | "mp3" | "m4a";
type Quality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
type Status = "queued" | "downloading" | "processing" | "completed" | "failed" | "cancelled";
type Job = {
  id: string;
  status: Status;
  percent: number;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  error: string | null;
  createdAt: number;
  fileName: string | null;
  fileBytes: number | null;
  fileUrl: string | null;
};

const qualityOptions: Quality[] = ["best", "2160", "1440", "1080", "720", "480", "360"];
const platformNames = ["YouTube", "Instagram", "TikTok", "X / Twitter", "Reddit", "Vimeo", "SoundCloud", "Twitch"];
const TERMINAL: Status[] = ["completed", "failed", "cancelled"];

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Unknown length";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0
    ? [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return Math.round(bytes) + " B";
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 ** 3) return (bytes / (1024 ** 2)).toFixed(1) + " MB";
  return (bytes / (1024 ** 3)).toFixed(2) + " GB";
}

async function readApi<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

export default function Downloader() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp4");
  const [quality, setQuality] = useState<Quality>("best");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const requestId = useRef(0);
  const busy = job !== null && !TERMINAL.includes(job.status);
  const currentJobId = job?.id;
  const currentStatus = job?.status;

  useEffect(() => {
    try {
      const id = sessionStorage.getItem("getdown:last-job");
      if (!id || !/^[0-9a-f-]{36}$/.test(id)) return;
      void fetch("/api/jobs/" + id, { cache: "no-store" })
        .then((response) => readApi<{ job: Job }>(response))
        .then((data) => setJob(data.job))
        .catch(() => sessionStorage.removeItem("getdown:last-job"));
    } catch {
      // Session storage can be unavailable in privacy-restricted contexts.
    }
  }, []);

  useEffect(() => {
    if (!currentJobId || !currentStatus || TERMINAL.includes(currentStatus)) return;
    let disposed = false;
    const controller = new AbortController();
    const interval = setInterval(() => {
      void fetch("/api/jobs/" + currentJobId, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => readApi<{ job: Job }>(response))
        .then((data) => {
          if (!disposed) {
            setJob((current) => current?.id === data.job.id ? data.job : current);
          }
        })
        .catch(() => {
          // Temporary network interruptions should not discard a running job.
        });
    }, 1_200);
    return () => {
      disposed = true;
      clearInterval(interval);
      controller.abort();
    };
  }, [currentJobId, currentStatus]);

  const analyze = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (analyzing || submitting || busy) return;
    const attempt = ++requestId.current;
    setError(null);
    setPreview(null);
    setAnalyzing(true);
    try {
      const response = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const result = await readApi<{ media: Preview }>(response);
      if (requestId.current !== attempt) return;
      setPreview(result.media);
      setPreviewUrl(url.trim());
      setFormat("mp4");
      setQuality("best");
    } catch (err) {
      if (requestId.current === attempt) {
        setError(err instanceof Error ? err.message : "Could not analyze this URL.");
      }
    } finally {
      if (requestId.current === attempt) setAnalyzing(false);
    }
  }, [analyzing, busy, submitting, url]);

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        requestId.current += 1;
        setUrl(text.trim());
        setPreview(null);
        setError(null);
        setAnalyzing(false);
      }
    } catch {
      setError("Clipboard access was blocked. Paste the URL manually instead.");
    }
  };

  const startDownload = async () => {
    if (!preview || submitting || busy) return;
    setError(null);
    setSubmitting(true);
    setJob(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: previewUrl, format, quality, title: preview.title }),
      });
      const result = await readApi<{ job: Job }>(response);
      setJob(result.job);
      try { sessionStorage.setItem("getdown:last-job", result.job.id); } catch { /* optional */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the download.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!job || cancelling) return;
    setCancelling(true);
    try {
      const response = await fetch("/api/jobs/" + job.id, { method: "DELETE" });
      const result = await readApi<{ job: Job }>(response);
      setJob(result.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the job.");
    } finally {
      setCancelling(false);
    }
  };

  const reset = () => {
    if (busy) return;
    requestId.current += 1;
    setJob(null);
    setPreview(null);
    setPreviewUrl("");
    setUrl("");
    setError(null);
    setQuality("best");
    setFormat("mp4");
    try { sessionStorage.removeItem("getdown:last-job"); } catch { /* optional */ }
  };

  const visibleQualities = qualityOptions.filter((item) =>
    item === "best" || !preview?.resolutions.length ||
    preview.resolutions.some((available) => available >= Number(item)),
  );
  const isComplete = job?.status === "completed";
  const isFailed = job?.status === "failed" || job?.status === "cancelled";

  return (
    <div className="app-shell">
      <div className="background-grid" aria-hidden="true" />
      <div className="content-wrap">
        <header className="site-header">
          <Link className="brand" href="/" aria-label="getdown home">
            <span className="brand-symbol"><ArrowDownToLine size={19} strokeWidth={2.6} /></span>
            <span>getdown<span className="brand-dot">.</span></span>
          </Link>
          <nav className="top-nav" aria-label="Main navigation">
            <a href="#supported">Supported sites</a>
            <a className="github-link" href="https://github.com/Livvux/downloader" target="_blank" rel="noopener noreferrer">
              <Github size={17} /><span>GitHub</span><ArrowUpRight size={14} />
            </a>
          </nav>
        </header>

        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="eyebrow"><span className="live-indicator" /> FREE &amp; OPEN SOURCE <span className="eyebrow-divider">/</span> POWERED BY YT-DLP</div>
            <h1 id="hero-title">Good content.<br /><span>Worth keeping.</span></h1>
            <p className="hero-subtitle">
              Download videos and audio from your favorite platforms.
              No apps to install. No accounts to create.
            </p>
          </section>

          <section className="download-card" aria-label="Media downloader">
            <div className="card-topline">
              <span><Link2 size={16} /> PASTE YOUR LINK</span>
              <span className="topline-note"><LockKeyhole size={13} /> No sign-up required</span>
            </div>

            <form className="url-form" onSubmit={(event) => void analyze(event)}>
              <div className="url-input-wrap">
                <Globe2 className="url-globe" size={21} strokeWidth={1.8} aria-hidden="true" />
                <input
                  aria-label="Media URL"
                  type="url"
                  inputMode="url"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste a video, reel, or audio URL..."
                  value={url}
                  onChange={(event) => {
                    requestId.current += 1;
                    setUrl(event.target.value);
                    setPreview(null);
                    setError(null);
                  }}
                  required
                  disabled={busy || analyzing || submitting}
                />
                <button type="button" className="paste-button" onClick={() => void pasteUrl()} disabled={busy || analyzing || submitting} aria-label="Paste URL from clipboard">
                  <Clipboard size={15} /><span>Paste</span>
                </button>
              </div>
              <button className="primary-button analyze-button" type="submit" disabled={busy || analyzing || submitting || !url.trim()}>
                {analyzing ? <LoaderCircle size={18} className="spinning" /> : <ArrowRight size={19} />}
                <span>{analyzing ? "Checking" : "Analyze"}</span>
              </button>
            </form>

            {error && (
              <div className="notice-error" role="alert">
                <X size={17} /><span>{error}</span>
                <button aria-label="Dismiss error" type="button" onClick={() => setError(null)}><X size={15} /></button>
              </div>
            )}

            {preview && !job && (
              <div className="preview-zone" aria-live="polite">
                <div className="section-rule" />
                <div className="preview-heading"><CheckCircle2 size={16} /> LINK FOUND <span>Ready to download</span></div>
                <div className="media-preview">
                  <div className="thumbnail">
                    {preview.thumbnail
                      ? <img src={preview.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      : <FileVideo2 size={28} />}
                    {preview.durationSeconds !== null && <span className="duration-badge">{formatDuration(preview.durationSeconds)}</span>}
                  </div>
                  <div className="media-info">
                    <div className="platform-label">{preview.platform}</div>
                    <h2 title={preview.title}>{preview.title}</h2>
                    <p>{preview.creator || "Media ready to save"}</p>
                  </div>
                  <span className="verified-icon"><Check size={17} /></span>
                </div>

                <div className="option-heading">CHOOSE FORMAT</div>
                <div className="format-grid" role="group" aria-label="Download format">
                  {([
                    { key: "mp4" as Format, title: "Video", suffix: "MP4", Icon: FileVideo2 },
                    { key: "mp3" as Format, title: "Audio", suffix: "MP3", Icon: Headphones },
                    { key: "m4a" as Format, title: "Audio", suffix: "M4A", Icon: Sparkles },
                  ]).map(({ key, title, suffix, Icon }) => (
                    <button
                      key={key}
                      type="button"
                      className={"format-option " + (format === key ? "format-selected" : "")}
                      aria-pressed={format === key}
                      onClick={() => setFormat(key)}
                    >
                      <Icon size={19} strokeWidth={1.8} />
                      <span className="format-text">{title}<small>{suffix}</small></span>
                      <span className="selection-indicator">{format === key && <Check size={12} strokeWidth={3} />}</span>
                    </button>
                  ))}
                </div>

                {format === "mp4" && (
                  <div className="quality-row">
                    <div><span className="quality-label">Video quality</span><span className="quality-hint">Higher quality means a larger file</span></div>
                    <select aria-label="Video quality" value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                      {visibleQualities.map((item) => (
                        <option key={item} value={item}>{item === "best" ? "Best available" : item + "p or lower"}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button type="button" className="primary-button download-button" onClick={() => void startDownload()} disabled={submitting}>
                  {submitting ? <LoaderCircle size={18} className="spinning" /> : <ArrowDownToLine size={19} />}
                  {submitting ? "Adding to queue..." : "Download " + format.toUpperCase()}
                  {!submitting && <ArrowRight className="button-arrow" size={18} />}
                </button>
              </div>
            )}

            {job && (
              <div className="job-zone" aria-live="polite">
                <div className="section-rule" />
                <div className="job-top">
                  <span className={"job-status-icon " + (isComplete ? "success" : isFailed ? "error" : "")}>
                    {isComplete ? <Check size={21} /> : isFailed ? <X size={21} /> : <ArrowDownToLine size={21} />}
                  </span>
                  <div>
                    <h2>{isComplete ? "Your download is ready" :
                      job.status === "failed" ? "Download failed" :
                      job.status === "cancelled" ? "Download cancelled" :
                      job.status === "queued" ? "Waiting for a free slot" :
                      job.status === "processing" ? "Preparing your file" : "Downloading your media"}</h2>
                    <p>{isComplete ? "Saved temporarily — download it to your device." :
                      isFailed ? (job.error || "You can try again with another link.") :
                      "You can leave this tab open while we prepare your file."}</p>
                  </div>
                </div>
                {!isFailed && (
                  <>
                    <div className="progress-top"><span>{isComplete ? "Complete" : "Progress"}</span><strong>{job.percent}%</strong></div>
                    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent} aria-label="Download progress">
                      <div className="progress-fill" style={{ width: job.percent + "%" }} />
                    </div>
                    <div className="progress-stats">
                      <span>{job.speedBytesPerSecond && !isComplete ? formatBytes(job.speedBytesPerSecond) + "/s" : isComplete ? formatBytes(job.fileBytes) : "Working..."}</span>
                      <span>{!isComplete && job.etaSeconds !== null ? "About " + Math.ceil(job.etaSeconds) + "s left" : isComplete ? "File is ready" : job.status === "queued" ? "Queued" : "Please wait"}</span>
                    </div>
                  </>
                )}
                {isComplete && job.fileUrl ? (
                  <a className="primary-button download-button" href={job.fileUrl} download={job.fileName || undefined}>
                    <ArrowDownToLine size={19} /> Save file <ArrowRight className="button-arrow" size={18} />
                  </a>
                ) : !isFailed ? (
                  <button type="button" className="cancel-button" onClick={() => void cancel()} disabled={cancelling}>
                    <X size={15} /> {cancelling ? "Cancelling..." : "Cancel download"}
                  </button>
                ) : null}
                {(isFailed || isComplete) && (
                  <button className="new-link-button" type="button" onClick={reset}>
                    <RotateCcw size={15} /> Download another
                  </button>
                )}
              </div>
            )}

            {!preview && !job && !analyzing && (
              <div className="card-tip">
                <span className="tip-spot"><Sparkles size={15} /></span>
                <p>Just paste a link. We&apos;ll find the available media and formats.</p>
              </div>
            )}
          </section>

          <section id="supported" className="supported-section" aria-label="Supported platforms">
            <div className="supported-title">WORKS WITH YOUR FAVORITES <span>+ more</span></div>
            <div className="platform-list">
              {platformNames.map((name) => <span key={name} className="platform-chip">{name}</span>)}
            </div>
          </section>

          <section className="features" aria-label="Why getdown">
            <div className="feature">
              <div className="feature-icon"><ShieldCheck size={21} /></div>
              <h3>Built for privacy</h3>
              <p>No accounts or tracking. Files are removed automatically after a short period.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><Headphones size={21} /></div>
              <h3>Any way you want it</h3>
              <p>Save videos as MP4, or extract high-quality audio in MP3 and M4A.</p>
            </div>
            <div className="feature">
              <div className="feature-icon"><Clock3 size={21} /></div>
              <h3>Simple by design</h3>
              <p>Paste a link, choose your format, and download. Nothing extra.</p>
            </div>
          </section>
        </main>

        <footer className="site-footer">
          <span className="footer-brand"><ArrowDownToLine size={14} /> getdown.</span>
          <p>Only download content you have permission to save.</p>
          <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer">Powered by yt-dlp <ArrowUpRight size={13} /></a>
        </footer>
      </div>
    </div>
  );
}
