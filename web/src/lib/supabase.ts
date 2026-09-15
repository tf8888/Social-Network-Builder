import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getServerConfig } from "./config";

export const CONTACTS_TABLE = "github_contacts";

let cachedClient: SupabaseClient | null = null;

// Server-only. Uses the service_role key, which bypasses RLS — that's
// deliberate (see supabase/migrations/0002_enable_rls.sql), but it means
// this function must never be called from client-side code.
export function getSupabaseServerClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const { supabaseUrl, supabaseServiceKey } = getServerConfig();
  cachedClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
