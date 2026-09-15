import { NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getJob, requestStop } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { jobId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.jobId) {
    return Response.json({ error: "unknown jobId" }, { status: 404 });
  }

  const supabase = getSupabaseServerClient();
  const job = await getJob(supabase, body.jobId);
  if (!job) {
    return Response.json({ error: "unknown jobId" }, { status: 404 });
  }

  if (body.action === "stop") {
    // Persisted (not just set in-memory) so whichever instance is running
    // the loop — possibly a different one than this request — picks it up
    // on its next poll and winds down, emitting its own "stopped" event.
    await requestStop(supabase, job.id);
    return Response.json({ ok: true, status: job.status });
  }

  return Response.json({ error: "unsupported action" }, { status: 400 });
}
