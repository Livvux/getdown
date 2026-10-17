import { inspectMedia } from "@/lib/yt-dlp";
import { json, rateLimit, requestBody, respondError } from "@/lib/http";
import { InputError, validateMediaUrl } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    rateLimit(request, "info");
    const body = await requestBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new InputError("Enter a media URL.");
    }
    const url = validateMediaUrl((body as Record<string, unknown>).url);
    const media = await inspectMedia(url);
    return json({ media });
  } catch (error) {
    return respondError(error);
  }
}
