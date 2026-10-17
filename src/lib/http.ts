import { NextResponse } from "next/server";
import { config } from "./config";
import { InputError } from "./validation";

type Bucket = { count: number; expiresAt: number };
const globalState = globalThis as typeof globalThis & {
  __downloaderRateLimits?: Map<string, Bucket>;
};
const buckets = globalState.__downloaderRateLimits ?? new Map<string, Bucket>();
globalState.__downloaderRateLimits = buckets;

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function respondError(error: unknown): NextResponse {
  if (error instanceof InputError) return json({ error: error.message }, error.status);
  console.error("[downloader]", error);
  return json({ error: "An unexpected server error occurred." }, 500);
}

export async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InputError("Expected a valid JSON request body.");
  }
}

export function rateLimit(request: Request, action: "info" | "jobs"): void {
  const now = Date.now();
  // Only trust forwarded IP information when the reverse proxy overwrites it.
  const address = config.trustProxyHeaders
    ? (request.headers.get("cf-connecting-ip") ||
       request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
       "unknown")
    : "global";
  const key = action + ":" + address.slice(0, 100);
  const limit = action === "info" ? 30 : 12;
  const bucket = buckets.get(key);
  if (!bucket || bucket.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt: now + 60_000 });
  } else {
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new InputError("Too many requests. Try again in a minute.", 429);
    }
  }
  if (buckets.size > 5_000) {
    for (const [name, entry] of buckets) {
      if (entry.expiresAt < now) buckets.delete(name);
    }
  }
}

export function noStoreHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
}
