import { createJob } from "@/lib/jobs";
import { json, rateLimit, requestBody, respondError } from "@/lib/http";
import { parseDownloadOptions } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    rateLimit(request, "jobs");
    const input = parseDownloadOptions(await requestBody(request));
    const job = createJob(input);
    return json({ job }, 202);
  } catch (error) {
    return respondError(error);
  }
}
