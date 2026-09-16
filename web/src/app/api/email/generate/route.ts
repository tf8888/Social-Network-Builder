import { NextRequest } from "next/server";
import { getGeminiApiKey } from "@/lib/config";
import { generateEmailDraft } from "@/lib/gemini";

export const dynamic = "force-dynamic";

interface GenerateBody {
  topic?: unknown;
  contact?: unknown;
  model?: unknown;
}

export async function POST(req: NextRequest) {
  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { topic, contact, model } = body;

  if (typeof topic !== "string" || !topic.trim()) {
    return Response.json({ error: "topic is required" }, { status: 400 });
  }
  if (model !== undefined && (typeof model !== "string" || !model.trim())) {
    return Response.json({ error: "model must be a non-empty string" }, { status: 400 });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set in the server environment (.env.local)." },
      { status: 500 }
    );
  }

  const contactObj = contact as
    | { username?: unknown; name?: unknown; company?: unknown; country?: unknown; bio?: unknown }
    | null
    | undefined;
  const normalizedContact =
    contactObj && typeof contactObj.username === "string"
      ? {
          username: contactObj.username,
          name: typeof contactObj.name === "string" ? contactObj.name : null,
          company: typeof contactObj.company === "string" ? contactObj.company : null,
          country: typeof contactObj.country === "string" ? contactObj.country : null,
          bio: typeof contactObj.bio === "string" ? contactObj.bio : null,
        }
      : null;

  const result = await generateEmailDraft({
    apiKey,
    topic: topic.trim(),
    contact: normalizedContact,
    model: typeof model === "string" ? model.trim() : undefined,
  });

  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json({ subject: result.subject, message: result.message });
}
