// Collect-job store, persisted in Supabase (see
// supabase/migrations/0006_create_collect_jobs.sql).
//
// Why not in-memory: on a serverless platform (Vercel) a running
// /api/collect stream, a /api/collect/control "stop" call, and a later
// /api/collect/resume call can each land on a different function
// instance with no shared memory. Persisting the job row lets any
// instance read/update the current state, so Stop/Resume work regardless
// of which instance handles which request.

import type { SupabaseClient } from "@supabase/supabase-js";

const JOBS_TABLE = "collect_jobs";

// Rows older than this are swept opportunistically on the next createJob
// call, so the table doesn't accumulate finished/abandoned jobs forever.
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

export interface CollectJob {
  id: string;
  keywords: string[];
  cap: number;
  seen: Set<number>;
  stored: number;
  skippedNoEmail: number;
  skippedDuplicate: number;
  keywordIndex: number;
  searchPage: number;
  status: "running" | "stopped" | "done" | "error";
  stopRequested: boolean;
  errorMessage?: string;
}

interface JobRow {
  id: string;
  keywords: string[];
  cap: number;
  seen_ids: number[];
  stored: number;
  skipped_no_email: number;
  skipped_duplicate: number;
  keyword_index: number;
  search_page: number;
  status: CollectJob["status"];
  stop_requested: boolean;
  error_message: string | null;
}

function fromRow(row: JobRow): CollectJob {
  return {
    id: row.id,
    keywords: row.keywords,
    cap: row.cap,
    seen: new Set(row.seen_ids ?? []),
    stored: row.stored,
    skippedNoEmail: row.skipped_no_email,
    skippedDuplicate: row.skipped_duplicate,
    keywordIndex: row.keyword_index,
    searchPage: row.search_page,
    status: row.status,
    stopRequested: row.stop_requested,
    errorMessage: row.error_message ?? undefined,
  };
}

async function sweepStaleJobs(supabase: SupabaseClient): Promise<void> {
  const cutoff = new Date(Date.now() - JOB_TTL_MS).toISOString();
  // Best-effort; a failed sweep should never block starting a new job.
  try {
    await supabase.from(JOBS_TABLE).delete().lt("updated_at", cutoff);
  } catch {
    // ignore
  }
}

export async function createJob(
  supabase: SupabaseClient,
  keywords: string[],
  cap: number
): Promise<CollectJob> {
  await sweepStaleJobs(supabase);

  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .insert({ keywords, cap })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "failed to create collect job");
  }
  return fromRow(data as JobRow);
}

export async function getJob(supabase: SupabaseClient, id: string): Promise<CollectJob | undefined> {
  const { data, error } = await supabase.from(JOBS_TABLE).select().eq("id", id).maybeSingle();
  if (error || !data) return undefined;
  return fromRow(data as JobRow);
}

// Cheap poll used mid-run to notice a Stop requested from another
// instance, without paying for a full row fetch each time.
export async function isStopRequested(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await supabase.from(JOBS_TABLE).select("stop_requested").eq("id", id).maybeSingle();
  return Boolean(data?.stop_requested);
}

// Persists current progress (called after each candidate is processed) so
// a Resume from a fresh instance can pick up close to where a run left
// off, even if the streaming response was cut off uncleanly.
export async function saveProgress(supabase: SupabaseClient, job: CollectJob): Promise<void> {
  await supabase
    .from(JOBS_TABLE)
    .update({
      seen_ids: Array.from(job.seen),
      stored: job.stored,
      skipped_no_email: job.skippedNoEmail,
      skipped_duplicate: job.skippedDuplicate,
      keyword_index: job.keywordIndex,
      search_page: job.searchPage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

export async function markJobStatus(
  supabase: SupabaseClient,
  job: CollectJob,
  status: CollectJob["status"],
  errorMessage?: string
): Promise<void> {
  job.status = status;
  job.errorMessage = errorMessage;
  await supabase
    .from(JOBS_TABLE)
    .update({
      status,
      error_message: errorMessage ?? null,
      stop_requested: status === "stopped" ? true : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

export async function requestStop(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(JOBS_TABLE)
    .update({ stop_requested: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("status")
    .maybeSingle();
  return !error && Boolean(data);
}

export async function markRunning(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase
    .from(JOBS_TABLE)
    .update({ status: "running", stop_requested: false, updated_at: new Date().toISOString() })
    .eq("id", id);
}
