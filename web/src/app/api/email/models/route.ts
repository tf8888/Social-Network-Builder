import { getGeminiApiKey } from "@/lib/config";
import { GEMINI_DEFAULT_MODEL, listGeminiModels } from "@/lib/gemini";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set in the server environment (.env.local)." },
      { status: 500 }
    );
  }

  const result = await listGeminiModels(apiKey);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json({ models: result.models ?? [], defaultModel: GEMINI_DEFAULT_MODEL });
}
