import { NextRequest } from "next/server";
import { getSupabaseServerClient, CONTACTS_TABLE } from "@/lib/supabase";
import { getResendApiKey, EMAIL_HARD_MAX_RECIPIENTS } from "@/lib/config";
import { resendSendEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

// Gap between sends -- Resend's default rate limit is a couple requests/sec;
// this keeps a single bulk run well under that without needing real backoff.
const DELAY_MS = 350;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SendBody {
  contactIds?: unknown;
  subject?: unknown;
  message?: unknown;
  from?: unknown;
}

export async function POST(req: NextRequest) {
  let body: SendBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { contactIds, subject, message, from } = body;

  if (!Array.isArray(contactIds) || contactIds.length === 0 || !contactIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "contactIds must be a non-empty array of strings" }, { status: 400 });
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return Response.json({ error: "subject is required" }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (typeof from !== "string" || !from.trim()) {
    return Response.json({ error: "from (sender address) is required" }, { status: 400 });
  }
  if (contactIds.length > EMAIL_HARD_MAX_RECIPIENTS) {
    return Response.json({ error: `at most ${EMAIL_HARD_MAX_RECIPIENTS} recipients per run` }, { status: 400 });
  }

  const apiKey = getResendApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "RESEND_API_KEY is not set in the server environment (.env.local)." },
      { status: 500 }
    );
  }

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data: rows, error: fetchError } = await supabase
    .from(CONTACTS_TABLE)
    .select("id, username, email")
    .in("id", contactIds);

  if (fetchError) {
    return Response.json({ error: fetchError.message }, { status: 500 });
  }

  const contacts = ((rows ?? []) as { id: string; username: string; email: string | null }[]).filter(
    (r): r is { id: string; username: string; email: string } => Boolean(r.email)
  );

  const subjectStr = subject.trim();
  const messageStr = message;
  const fromStr = from.trim();
  const html = messageStr.replace(/\n/g, "<br>");

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      function emit(event: object) {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      emit({ type: "start", total: contacts.length });
      let sent = 0;
      let failed = 0;

      for (const contact of contacts) {
        if (req.signal.aborted) {
          emit({ type: "stopped", sent, failed });
          closed = true;
          controller.close();
          return;
        }

        const result = await resendSendEmail({
          apiKey,
          from: fromStr,
          to: contact.email,
          subject: subjectStr,
          html,
          text: messageStr,
        });

        if (result.error) {
          failed += 1;
          await supabase
            .from(CONTACTS_TABLE)
            .update({ email_status: "failed", email_error: result.error })
            .eq("id", contact.id);
          emit({ type: "failed", username: contact.username, email: contact.email, error: result.error });
        } else {
          sent += 1;
          await supabase
            .from(CONTACTS_TABLE)
            .update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null })
            .eq("id", contact.id);
          emit({ type: "sent", username: contact.username, email: contact.email });
        }

        await sleep(DELAY_MS);
      }

      emit({ type: "done", sent, failed });
      closed = true;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
