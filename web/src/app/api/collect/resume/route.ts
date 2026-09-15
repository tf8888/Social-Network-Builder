import { NextRequest } from "next/server";
import { getServerConfig } from "@/lib/config";
import { getSupabaseServerClient } from "@/lib/supabase";
import { GithubClient } from "@/lib/github";
import { getJob, markRunning } from "@/lib/jobs";
import { runJob } from "@/lib/collectRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.jobId) {
    return Response.json({ error: "unknown jobId — it may have expired; start a new run" }, { status: 404 });
  }

  let config;
  try {
    config = getServerConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const supabase = getSupabaseServerClient();
  const job = await getJob(supabase, body.jobId);
  if (!job) {
    return Response.json({ error: "unknown jobId — it may have expired; start a new run" }, { status: 404 });
  }
  if (job.status !== "stopped") {
    return Response.json({ error: `job is "${job.status}", not stopped — nothing to resume` }, { status: 400 });
  }

  await markRunning(supabase, job.id);
  job.status = "running";
  job.stopRequested = false;

  const encoder = new TextEncoder();
  const gh = new GithubClient(config.githubToken, 2500, 1000);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          job.stopRequested = true;
        }
      };
      send({ type: "resumed", jobId: job.id, stored: job.stored, cap: job.cap });
      await runJob(job, gh, supabase, send);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
