export class InputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "InputError";
    this.status = status;
  }
}

// A domain allowlist is intentional: yt-dlp can otherwise be used to request
// arbitrary internal URLs (SSRF). Operators may extend it via environment.
export const supportedPlatforms = [
  { name: "YouTube", host: "youtube.com" },
  { name: "YouTube", host: "youtu.be" },
  { name: "TikTok", host: "tiktok.com" },
  { name: "Instagram", host: "instagram.com" },
  { name: "X / Twitter", host: "x.com" },
  { name: "X / Twitter", host: "twitter.com" },
  { name: "Reddit", host: "reddit.com" },
  { name: "Vimeo", host: "vimeo.com" },
  { name: "Twitch", host: "twitch.tv" },
  { name: "SoundCloud", host: "soundcloud.com" },
  { name: "Facebook", host: "facebook.com" },
  { name: "Facebook", host: "fb.watch" },
  { name: "Pinterest", host: "pinterest.com" },
  { name: "Pinterest", host: "pin.it" },
  { name: "Dailymotion", host: "dailymotion.com" },
  { name: "Streamable", host: "streamable.com" },
  { name: "Bandcamp", host: "bandcamp.com" },
  { name: "Bilibili", host: "bilibili.com" },
  { name: "Bluesky", host: "bsky.app" },
  { name: "Tumblr", host: "tumblr.com" },
  { name: "Imgur", host: "imgur.com" },
  { name: "Rumble", host: "rumble.com" },
  { name: "Kick", host: "kick.com" },
] as const;

const baseHosts: readonly string[] = supportedPlatforms.map((platform) => platform.host);
const extraHosts = (process.env.ADDITIONAL_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter((host) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host))
  .filter((host) => !host.endsWith(".local") && !host.endsWith(".internal"));

function matchesHost(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith("." + allowed);
}

export function validateMediaUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) {
    throw new InputError("Enter a valid media URL (maximum 2,048 characters).");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new InputError("Enter a complete URL, including https://.");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new InputError("Only HTTPS media URLs are supported.");
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new InputError("URLs with credentials or custom ports are not supported.");
  }
  // Even if the user pastes HTTP, make the initial connection over HTTPS.
  parsed.protocol = "https:";
  parsed.hash = "";
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (![...baseHosts, ...extraHosts].some((host) => matchesHost(hostname, host))) {
    throw new InputError(
      "This website is not enabled. Ask the server administrator to allow its domain.",
      422,
    );
  }
  return parsed.toString();
}

export const qualities = ["best", "2160", "1440", "1080", "720", "480", "360"] as const;
export const formats = ["mp4", "mp3", "m4a"] as const;
export type Quality = (typeof qualities)[number];
export type DownloadFormat = (typeof formats)[number];

export type DownloadOptions = {
  url: string;
  quality: Quality;
  format: DownloadFormat;
  title: string;
};

export function parseDownloadOptions(input: unknown): DownloadOptions {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InputError("Invalid download request.");
  }
  const data = input as Record<string, unknown>;
  const url = validateMediaUrl(data.url);
  const quality = data.quality === undefined ? "best" : data.quality;
  const format = data.format === undefined ? "mp4" : data.format;
  if (!qualities.includes(quality as Quality)) {
    throw new InputError("Choose a supported video quality.");
  }
  if (!formats.includes(format as DownloadFormat)) {
    throw new InputError("Choose MP4, MP3 or M4A.");
  }
  return {
    url,
    quality: quality as Quality,
    format: format as DownloadFormat,
    title: typeof data.title === "string" ? data.title.slice(0, 160) : "download",
  };
}

export function safeFilename(title: string): string {
  const cleaned = title.normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 110);
  return cleaned || "download";
}
