import { NextRequest } from "next/server";
import { getSupabaseServerClient, CONTACTS_TABLE } from "@/lib/supabase";
import { sanitizeContactInput } from "@/lib/contactFields";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "no editable fields provided" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from(CONTACTS_TABLE)
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ row: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { error } = await supabase.from(CONTACTS_TABLE).delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
