import { NextRequest } from "next/server";
import { getServerConfig, clampMaxUsers } from "@/lib/config";
import { getSupabaseServerClient } from "@/lib/supabase";
import { GithubClient } from "@/lib/github";
import { createJob } from "@/lib/jobs";
import { runJob } from "@/lib/collectRunner";

export const dynamic = "force-dynamic";
// Hint only — actually honored on platforms that support long-running
// functions (e.g. Vercel Pro/Fluid). On a short-timeout serverless plan this
// endpoint may get cut off mid-run; that's fine here since the job survives
// server-side and Resume can pick it back up (as long as the process itself
// didn't restart — jobs are in-memory, see src/lib/jobs.ts).
export const maxDuration = 120;

interface CollectRequestBody {
  keywords?: string[];
  maxUsers?: number;
}

export async function POST(req: NextRequest) {
  let body: CollectRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let config;
  try {
    config = getServerConfig();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const keywords = (body.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) {
    return Response.json({ error: "at least one keyword is required" }, { status: 400 });
  }

  const cap = clampMaxUsers(body.maxUsers ?? 10);
  const encoder = new TextEncoder();
  const supabase = getSupabaseServerClient();
  const gh = new GithubClient(config.githubToken, 2500, 1000);

  let job;
  try {
    job = await createJob(supabase, keywords, cap);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected — stop wasting GitHub API calls on a dead stream.
          job.stopRequested = true;
        }
      };
      send({ type: "start", jobId: job.id, keywords, cap });
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
