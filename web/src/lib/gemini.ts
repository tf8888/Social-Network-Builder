// Server-only. Thin wrapper around the Gemini REST API — no SDK dependency,
// matching how src/lib/resend.ts and src/lib/github.ts talk to their APIs.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-3.6-flash";

export interface GeminiModel {
  id: string;
  displayName: string;
}

// Models get deprecated/renamed on Google's side fairly often (we hit this
// mid-build: gemini-2.5-flash was sunset in favor of gemini-3.6-flash) — so
// list what's actually available to this key instead of hardcoding options.
export async function listGeminiModels(apiKey: string): Promise<{ models?: GeminiModel[]; error?: string }> {
  try {
    const resp = await fetch(`${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`);
    const json = await resp.json().catch(() => ({}) as Record<string, unknown>);
    if (!resp.ok) {
      const message =
        (typeof (json as { error?: { message?: string } }).error?.message === "string" &&
          (json as { error?: { message?: string } }).error!.message) ||
        `Gemini API error (${resp.status})`;
      return { error: message };
    }

    const raw = (json as { models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[] })
      .models ?? [];
    const models = raw
      .filter((m) => m.name?.startsWith("models/") && m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({ id: m.name!.slice("models/".length), displayName: m.displayName || m.name!.slice("models/".length) }));

    return { models };
  } catch (err) {
    return { error: (err as Error).message || "network error calling Gemini" };
  }
}

export interface GenerateEmailDraftParams {
  apiKey: string;
  topic: string;
  model?: string;
  senderName?: string;
  contact?: {
    username: string;
    name?: string | null;
    company?: string | null;
    country?: string | null;
    bio?: string | null;
  } | null;
}

export interface GenerateEmailDraftResult {
  subject?: string;
  message?: string;
  error?: string;
}

// This is what keeps drafts from reading like "AI wrote this" — a real
// system role (kept separate from the per-request user turn below), a
// concrete structural template, and checkable rules rather than vague vibes
// like "sound human".
const EMAIL_WRITER_SYSTEM_PROMPT = `You are an expert outreach copywriter who ghostwrites emails for a real person doing developer recruiting/networking outreach on GitHub. You write the way a thoughtful, busy professional actually writes when they mean it — not like an AI, and not like a fill-in-the-blank template.

STRUCTURE — build the "message" out of these parts, in this order:
1. Greeting: "Hi {first name}," using the recipient's first name if one was given, otherwise "Hi there,".
2. Opening line: one sentence stating exactly why you're reaching out, tied directly to the topic — no throat-clearing before it.
3. Context: 1-3 sentences giving the concrete details — what this actually is, why it's relevant to them, and (if genuinely true for this topic) a reassurance like cost, time required, or "no obligation".
4. Action list — INCLUDE ONLY IF the topic naturally breaks into multiple concrete items (things to prepare, steps to take, topics covered, requirements). Skip this part entirely for a simple one-ask email; don't force a list where there isn't one. When you do include it: one short lead-in sentence ending in a colon, then each item on its own line prefixed with "- " (a hyphen and a space) — nothing fancier.
5. Support line: one short sentence offering to help or answer questions, only if it fits naturally — skip it for a very short email where it would just be filler.
6. Call to action: exactly one clear, specific next step, as its own short paragraph — never more than one ask in the whole email.
7. Sign-off: the closing word alone on its own line ("Thank you," / "Best," / "Thanks," / "Cheers," — pick what fits the tone), then the sender's name on the next line if the user turn gave you one. If no sender name was given, end at the closing word — the human sending it adds their own name.

VOICE AND STYLE
- Sound like a real person wrote this in a few focused minutes. Vary sentence length; don't make every sentence the same shape.
- Never open with "I hope this email finds you well", "I hope this message finds you well", or any close variant.
- Ban corporate buzzwords and AI-tell phrases: "synergy", "leverage", "unlock", "circle back", "passionate about", "reach out" (as a verb), "in today's fast-paced world", "I wanted to touch base", "game-changer", "seamless", "robust solution".
- No emoji. No exclamation-point stacking (at most one, and only if it's earned). No ALL CAPS. No markdown (no headers, no **bold**/*italic*, no numbered lists) — the only allowed list format is the plain "- item" lines described in step 4.
- Be warm but direct.
- Paragraphs stay short (1-3 sentences). The template adds real structure, not padding — never restate the ask twice, never repeat a point already made.

PERSONALIZATION
- If recipient details are provided, weave in exactly ONE specific, relevant detail naturally — don't recite their bio back at them like a summary, and don't force a detail that doesn't actually connect to the topic.
- Never invent or assume facts about the recipient beyond what's given.
- If no recipient details are provided, keep it generic in address but still concrete and specific about the topic — never generic filler copy.

REALISM AND OUTPUT CONTRACT
- Produce ready-to-send copy: no placeholders like [Name], [Company], [Link], no bracketed instructions, nothing left for a human to fill in.
- Subject line: under ~60 characters, specific to the actual content, non-spammy — no "Quick question", no clickbait, no Title Casing Every Word.
- Write plain text only (the "message" field is sent as both the email body and its plain-text fallback) — separate the structural parts above with a blank line between them.
- Respond with ONLY the JSON object matching the given schema — no commentary, no markdown fences around it.`;

export async function generateEmailDraft(params: GenerateEmailDraftParams): Promise<GenerateEmailDraftResult> {
  const { apiKey, topic, contact, model = GEMINI_DEFAULT_MODEL, senderName } = params;

  const contactLines = contact
    ? [
        `Recipient GitHub username: ${contact.username}`,
        contact.name && `Name: ${contact.name}`,
        contact.company && `Company: ${contact.company}`,
        contact.country && `Country: ${contact.country}`,
        contact.bio && `Bio: ${contact.bio}`,
      ].filter(Boolean)
    : [];

  const userTurn = [
    contactLines.length > 0
      ? "Recipient info (weave in exactly one relevant detail, naturally):"
      : "No specific recipient — keep it generic but still concrete about the topic below.",
    ...contactLines,
    "",
    `What this email is about: ${topic}`,
    "",
    senderName ? `Sender's name (sign off with this exact name): ${senderName}` : "No sender name given — leave the sign-off without a name.",
  ].join("\n");

  try {
    const resp = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { role: "system", parts: [{ text: EMAIL_WRITER_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userTurn }] }],
          generationConfig: {
            temperature: 0.9,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                subject: { type: "STRING" },
                message: { type: "STRING" },
              },
              required: ["subject", "message"],
            },
          },
        }),
      }
    );

    const json = await resp.json().catch(() => ({}) as Record<string, unknown>);
    if (!resp.ok) {
      const message =
        (typeof (json as { error?: { message?: string } }).error?.message === "string" &&
          (json as { error?: { message?: string } }).error!.message) ||
        `Gemini API error (${resp.status})`;
      return { error: message };
    }

    const text = extractText(json);
    if (!text) return { error: "Gemini returned an empty response." };

    const parsed = JSON.parse(text) as { subject?: unknown; message?: unknown };
    if (typeof parsed.subject !== "string" || typeof parsed.message !== "string") {
      return { error: "Gemini response was missing subject/message." };
    }
    return { subject: parsed.subject, message: parsed.message };
  } catch (err) {
    return { error: (err as Error).message || "network error calling Gemini" };
  }
}

function extractText(json: unknown): string | null {
  const candidates = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  const text = parts?.map((p) => p.text ?? "").join("") ?? "";
  return text.trim() || null;
}
