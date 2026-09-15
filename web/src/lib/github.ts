// Thin GitHub REST client — ported from the Python collector (src/github_client.py
// at the project root) so both surfaces share the same scoping rules:
//
// - Only reads the profile `email` field from GET /users/{username}, which is
//   null unless the user chose to make it public. Never falls back to scraping
//   commit metadata for emails.
// - Backs off on secondary rate limits / abuse detection using GitHub's own
//   Retry-After / X-RateLimit-Reset headers instead of hammering the API.

const API_BASE = "https://api.github.com";

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  location: string | null;
  blog: string | null;
  company: string | null;
  bio: string | null;
  public_repos: number | null;
  followers: number | null;
  following: number | null;
  created_at: string | null;
}

export interface SearchHit {
  id: number;
  login: string;
}

export interface SearchPageResult {
  items: SearchHit[];
  hasMore: boolean;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GithubClient {
  constructor(
    private token: string,
    readonly searchDelayMs: number,
    readonly coreDelayMs: number
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "portfolio-github-etl-demo",
    };
  }

  private async getWithBackoff(
    path: string,
    params: Record<string, string>
  ): Promise<Response> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    for (let attempt = 0; attempt < 5; attempt++) {
      const resp = await fetch(url.toString(), { headers: this.headers() });

      if (resp.status === 200 || resp.status === 404) return resp;

      if (resp.status === 403 || resp.status === 429) {
        const retryAfter = resp.headers.get("retry-after");
        const resetAt = resp.headers.get("x-ratelimit-reset");
        let waitMs: number;
        if (retryAfter) waitMs = Number(retryAfter) * 1000;
        else if (resetAt) waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 1000;
        else waitMs = 2 ** attempt * 1000;
        await sleep(waitMs);
        continue;
      }

      if (resp.status >= 500) {
        await sleep(2 ** attempt * 1000);
        continue;
      }

      throw new Error(`GitHub API error ${resp.status} on ${path}: ${await resp.text()}`);
    }

    throw new Error(`GitHub API: exhausted retries on ${path}`);
  }

  // Fetches a single page of search results. Callers own paging/delay so a
  // job can persist exactly which page it's on and resume from there after
  // a stop, instead of restarting a keyword from page 1.
  async searchPage(query: string, page: number, perPage = 30): Promise<SearchPageResult> {
    const resp = await this.getWithBackoff("/search/users", {
      q: query,
      per_page: String(perPage),
      page: String(page),
    });
    const data = await resp.json();
    const items: SearchHit[] = data.items ?? [];
    return { items, hasMore: items.length === perPage };
  }

  async getUser(username: string): Promise<GithubProfile | null> {
    const resp = await this.getWithBackoff(`/users/${encodeURIComponent(username)}`, {});
    await sleep(this.coreDelayMs);
    if (resp.status === 404) return null;
    return (await resp.json()) as GithubProfile;
  }
}
