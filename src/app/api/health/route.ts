import { checkDependencies } from "@/lib/yt-dlp";
import { startCleanup } from "@/lib/jobs";
import { json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  startCleanup();
  const dependencies = await checkDependencies();
  const healthy = dependencies.ytDlp && dependencies.ffmpeg;
  return json({ status: healthy ? "ok" : "unavailable", dependencies }, healthy ? 200 : 503);
}
