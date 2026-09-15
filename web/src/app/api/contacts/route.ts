import { NextRequest } from "next/server";
import { getSupabaseServerClient, CONTACTS_TABLE } from "@/lib/supabase";
import { sanitizeContactInput } from "@/lib/contactFields";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
// Larger cap used by the send-email modal, which needs bigger batches to
// select from than the dashboard's normal page-by-page browsing.
const MAX_PAGE_SIZE = 200;

const EMAIL_STATUSES = new Set(["not_sent", "sent", "failed"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const country = (searchParams.get("country") ?? "").trim();
  const emailStatusParam = (searchParams.get("emailStatus") ?? "").trim();
  const emailStatus = EMAIL_STATUSES.has(emailStatusParam) ? emailStatusParam : "";
  const hasEmail = searchParams.get("hasEmail") === "true";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize") ?? String(PAGE_SIZE)) || PAGE_SIZE)
  );
  const offset = (page - 1) * pageSize;

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  let query = supabase.from(CONTACTS_TABLE).select("*", { count: "exact" });
  if (q) {
    const escaped = q.replace(/,/g, "");
    query = query.or(
      `username.ilike.%${escaped}%,name.ilike.%${escaped}%,email.ilike.%${escaped}%`
    );
  }
  if (country) {
    query = query.ilike("country", `%${country}%`);
  }
  if (emailStatus) {
    query = query.eq("email_status", emailStatus);
  }
  if (hasEmail) {
    query = query.not("email", "is", null);
  }

  const { data, count, error } = await query
    .order("collected_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const { count: totalAll } = await supabase
    .from(CONTACTS_TABLE)
    .select("id", { count: "exact", head: true });

  const { data: countryRows } = await supabase.from(CONTACTS_TABLE).select("country");
  const counts: Record<string, number> = {};
  for (const row of (countryRows ?? []) as { country: string | null }[]) {
    const key = row.country || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const topCountries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return Response.json({
    rows: data ?? [],
    page,
    totalMatching: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
    totalAll: totalAll ?? 0,
    topCountries,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch = sanitizeContactInput(body);
  if ("error" in patch) {
    return Response.json({ error: patch.error }, { status: 400 });
  }
  if (!patch.username) {
    return Response.json({ error: "username is required" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  // github_id is left null -- this is a manually-added contact, not tied to
  // a real scraped GitHub account. The unique constraint on github_id
  // allows any number of NULLs (Postgres treats each NULL as distinct).
  const { data, error } = await supabase
    .from(CONTACTS_TABLE)
    .insert({ ...patch, search_keyword: "manual" })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ row: data }, { status: 201 });
}
