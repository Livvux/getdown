import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { findCompletedFile } from "@/lib/jobs";
import { json, noStoreHeaders } from "@/lib/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const file = findCompletedFile(id);
  if (!file) return json({ error: "File not found or expired." }, 404);
  try {
    const stats = await stat(file.path);
    if (!stats.isFile() || stats.size !== file.bytes) {
      return json({ error: "File is no longer available." }, 410);
    }
  } catch {
    return json({ error: "File is no longer available." }, 410);
  }

  const headers = noStoreHeaders();
  const ext = file.name.split(".").pop();
  headers.set("Content-Type", ext === "mp4" ? "video/mp4" :
    ext === "mp3" ? "audio/mpeg" : "audio/mp4");
  headers.set("Content-Length", String(file.bytes));
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  headers.set("Content-Disposition",
    'attachment; filename="' + ascii + '"; filename*=UTF-8' + "''" + encodeURIComponent(file.name));
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: 200, headers });
}
