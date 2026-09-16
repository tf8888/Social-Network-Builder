// Server-only. Thin wrapper around the Gemini REST API — no SDK dependency,
// matching how src/lib/resend.ts and src/lib/github.ts talk to their APIs.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-3.6-flash";

export interface GenerateEmailDraftParams {
  apiKey: string;
  topic: string;
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

export async function generateEmailDraft(params: GenerateEmailDraftParams): Promise<GenerateEmailDraftResult> {
  const { apiKey, topic, contact } = params;

  const contactLines = contact
    ? [
        `Recipient GitHub username: ${contact.username}`,
        contact.name && `Name: ${contact.name}`,
        contact.company && `Company: ${contact.company}`,
        contact.country && `Country: ${contact.country}`,
        contact.bio && `Bio: ${contact.bio}`,
      ].filter(Boolean)
    : [];

  const prompt = [
    "Draft a short, friendly cold outreach email for a developer recruiting/networking campaign.",
    "Return plain text only, no markdown formatting, no placeholders like [Name] left unfilled.",
    contactLines.length > 0 ? "Personalize it using this recipient info:" : "No specific recipient — keep it generic and addressed to a developer.",
    ...contactLines,
    `What the email should be about: ${topic}`,
  ].join("\n");

  try {
    const resp = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
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
