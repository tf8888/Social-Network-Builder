import { getResendApiKey } from "@/lib/config";
import { resendGetVerifiedDomain } from "@/lib/resend";

export const dynamic = "force-dynamic";

// Used by the send-email modal to prefill the sender address: if Resend
// reports a verified domain on this account, the UI defaults the "from"
// input to it; otherwise it leaves that input blank/free-text.
export async function GET() {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    return Response.json({ configured: false, domain: null });
  }
  const domain = await resendGetVerifiedDomain(apiKey);
  return Response.json({ configured: true, domain });
}
