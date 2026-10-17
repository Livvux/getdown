import { cancelJob, findJob } from "@/lib/jobs";
import { json } from "@/lib/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = findJob(id);
  return job ? json({ job }) : json({ error: "Job not found or expired." }, 404);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = cancelJob(id);
  return job ? json({ job }) : json({ error: "Job not found or expired." }, 404);
}
