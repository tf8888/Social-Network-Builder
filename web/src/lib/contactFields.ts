// Fields a human can create/edit from the dashboard. Deliberately excludes
// system/scrape-derived columns (id, github_id, avatar_url, public_repos,
// followers, following, account_created_at, github_experience_years,
// search_keyword, collected_at) — those stay whatever the collector wrote
// (or null, for a manually-added contact).

const EDITABLE_FIELDS = [
  "username",
  "name",
  "email",
  "country",
  "portfolio_url",
  "company",
  "bio",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

export type ContactPatch = Partial<Record<EditableField, string | null>>;

export function sanitizeContactInput(body: unknown): ContactPatch | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "expected a JSON object" };
  }
  const input = body as Record<string, unknown>;
  const patch: ContactPatch = {};

  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === null || value === undefined || value === "") {
      patch[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      return { error: `${field} must be a string` };
    }
    patch[field] = value.trim();
  }

  return patch;
}
