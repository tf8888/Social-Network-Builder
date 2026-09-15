import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACTS_TABLE } from "./supabase";
import { GithubClient, sleep } from "./github";
import { CollectJob, isStopRequested, markJobStatus, saveProgress } from "./jobs";

export type SendFn = (event: Record<string, unknown>) => void;

function yearsSince(iso: string): number {
  const created = new Date(iso).getTime();
  const now = Date.now();
  return Math.round(((now - created) / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10;
}

/**
 * Advances a job until it's stopped, done, or errors. Shared by the
 * initial /api/collect run and /api/collect/resume so both persist
 * progress onto the same job object and can hand off to one another.
 */
export async function runJob(
  job: CollectJob,
  gh: GithubClient,
  supabase: SupabaseClient,
  send: SendFn
): Promise<void> {
  // A Stop can be requested from a different serverless instance than the
  // one running this loop (see src/lib/jobs.ts), so the local flag alone
  // isn't enough — poll the persisted row too.
  async function stopWasRequested(): Promise<boolean> {
    return job.stopRequested || (await isStopRequested(supabase, job.id));
  }
  async function persist(): Promise<void> {
    await saveProgress(supabase, job);
  }

  try {
    outer: while (job.keywordIndex < job.keywords.length) {
      if (job.stored >= job.cap) break;
      const keyword = job.keywords[job.keywordIndex];

      if (job.searchPage === 1) {
        send({ type: "searching", keyword });
      }

      for (;;) {
        if (await stopWasRequested()) {
          await markJobStatus(supabase, job, "stopped");
          send({ type: "stopped", stored: job.stored });
          return;
        }
        if (job.stored >= job.cap) break outer;

        const { items, hasMore } = await gh.searchPage(keyword, job.searchPage);

        if (items.length === 0) {
          job.searchPage = 1;
          job.keywordIndex += 1;
          await persist();
          break;
        }

        for (const hit of items) {
          if (await stopWasRequested()) {
            await markJobStatus(supabase, job, "stopped");
            send({ type: "stopped", stored: job.stored });
            return;
          }
          if (job.stored >= job.cap) break outer;
          if (job.seen.has(hit.id)) continue;
          job.seen.add(hit.id);

          const profile = await gh.getUser(hit.login);
          if (!profile) {
            await persist();
            continue;
          }

          if (!profile.email) {
            job.skippedNoEmail += 1;
            await persist();
            send({ type: "skip_no_email", username: profile.login });
            continue;
          }

          const record = {
            github_id: profile.id,
            username: profile.login,
            name: profile.name,
            email: profile.email,
            avatar_url: profile.avatar_url,
            country: profile.location,
            portfolio_url: profile.blog || null,
            company: profile.company,
            bio: profile.bio,
            public_repos: profile.public_repos,
            followers: profile.followers,
            following: profile.following,
            account_created_at: profile.created_at,
            github_experience_years: profile.created_at ? yearsSince(profile.created_at) : null,
            search_keyword: keyword,
          };

          const { error } = await supabase
            .from(CONTACTS_TABLE)
            .upsert(record, { onConflict: "github_id" });

          if (error) {
            const isDuplicateEmail =
              error.code === "23505" || error.message?.includes("github_contacts_email_unique_idx");
            if (isDuplicateEmail) {
              job.skippedDuplicate += 1;
              await persist();
              send({ type: "skip_duplicate_email", username: profile.login });
              continue;
            }
            throw new Error(error.message);
          }

          job.stored += 1;
          await persist();
          send({ type: "stored", username: profile.login, email: profile.email });
        }

        if (!hasMore) {
          job.searchPage = 1;
          job.keywordIndex += 1;
          await persist();
          break;
        }
        job.searchPage += 1;
        await persist();
        send({ type: "searching", keyword });
        await sleep(gh.searchDelayMs);
      }
    }

    await markJobStatus(supabase, job, "done");
    send({
      type: "done",
      stored: job.stored,
      skippedNoEmail: job.skippedNoEmail,
      skippedDuplicate: job.skippedDuplicate,
    });
  } catch (err) {
    const message = (err as Error).message;
    await markJobStatus(supabase, job, "error", message);
    send({ type: "error", message });
  }
}
