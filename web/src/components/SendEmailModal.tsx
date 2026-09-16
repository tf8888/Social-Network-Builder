"use client";

import { useEffect, useRef, useState } from "react";
import type { Contact, ContactsResponse, EmailStatus, SendEmailEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import ContactAvatar from "./ContactAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Search,
  Sparkles,
} from "lucide-react";

const LIST_PAGE_SIZE = 20;
// Matches the server's EMAIL_HARD_MAX_RECIPIENTS (src/lib/config.ts) — kept
// in sync manually since that constant is server-only.
const MAX_RECIPIENTS = 100;

type StatusFilter = "" | EmailStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "not_sent", label: "New" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
];

const STATUS_BADGE: Record<EmailStatus, { label: string; className: string }> = {
  not_sent: { label: "New", className: "text-muted-foreground" },
  sent: { label: "Sent", className: "border-success/30 bg-success/10 text-success" },
  failed: { label: "Failed", className: "border-destructive/30 bg-destructive/10 text-destructive" },
};

type LogEntry = { kind: "sent" | "failed"; text: string };
type SendStatus = "idle" | "running" | "done" | "error";

export default function SendEmailModal({ onFinished }: { onFinished: () => void }) {
  // Filters + contact picker
  const [qInput, setQInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<Map<string, Contact>>(new Map());

  // Sender domain lookup
  const [domain, setDomain] = useState<string | null>(null);
  const [domainChecked, setDomainChecked] = useState(false);

  // Compose fields
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [prefilledFrom, setPrefilledFrom] = useState(false);

  // AI draft generation (Gemini)
  const [topicInput, setTopicInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Send run
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 });
  const [summary, setSummary] = useState<{ ok: boolean; text: string } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Look up a verified Resend domain once, to prefill "from" when possible.
  // Only overwrite the field automatically the first time it resolves —
  // never clobber something the user already typed.
  useEffect(() => {
    let ignore = false;
    fetch("/api/email/domain")
      .then((r) => r.json())
      .then((json: { configured: boolean; domain: string | null }) => {
        if (ignore) return;
        setDomainChecked(true);
        if (json.domain) {
          setDomain(json.domain);
          setFrom((f) => (f ? f : `outreach@${json.domain}`));
          setPrefilledFrom(true);
        }
      })
      .catch(() => {
        if (!ignore) setDomainChecked(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Look up which Gemini models this API key can actually use — model ids
  // get renamed/deprecated on Google's side (see src/lib/gemini.ts), so this
  // is more reliable than hardcoding a fixed list in the UI.
  useEffect(() => {
    let ignore = false;
    fetch("/api/email/models")
      .then((r) => r.json())
      .then((json: { models?: { id: string; displayName: string }[]; defaultModel?: string; error?: string }) => {
        if (ignore) return;
        if (json.error) {
          setModelsError(json.error);
          return;
        }
        const list = json.models ?? [];
        setModels(list);
        const preferred = list.find((m) => m.id === json.defaultModel) ?? list[0];
        if (preferred) setSelectedModel(preferred.id);
      })
      .catch(() => {
        if (!ignore) setModelsError("Could not reach Gemini to list models.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  const q = qInput.trim();
  const country = countryInput.trim();

  // Same fetch-in-effect pattern (and same scoped lint disable) as
  // ContactsDashboard's own contacts fetch — see the comment there.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let ignore = false;
    setListLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(LIST_PAGE_SIZE),
      hasEmail: "true",
    });
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    if (statusFilter) params.set("emailStatus", statusFilter);

    fetch(`/api/contacts?${params.toString()}`)
      .then((r) => r.json())
      .then((json: ContactsResponse) => {
        if (ignore) return;
        setData(json);
        setListLoading(false);
      })
      .catch(() => {
        if (!ignore) setListLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [q, country, statusFilter, page]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Reset to page 1 when a filter changes.
  const filterKey = `${q}::${country}::${statusFilter}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const rows = data?.rows ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const running = sendStatus === "running";

  function toggleOne(contact: Contact) {
    setSelected((s) => {
      const next = new Map(s);
      if (next.has(contact.id)) next.delete(contact.id);
      else next.set(contact.id, contact);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Map(s);
      if (allOnPageSelected) {
        rows.forEach((r) => next.delete(r.id));
      } else {
        rows.forEach((r) => next.set(r.id, r));
      }
      return next;
    });
  }

  async function selectAllMatching() {
    const params = new URLSearchParams({
      page: "1",
      pageSize: String(MAX_RECIPIENTS),
      hasEmail: "true",
    });
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    if (statusFilter) params.set("emailStatus", statusFilter);

    const resp = await fetch(`/api/contacts?${params.toString()}`);
    const json: ContactsResponse = await resp.json();
    setSelected((s) => {
      const next = new Map(s);
      json.rows.forEach((r) => next.set(r.id, r));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Map());
  }

  function pushLog(entry: LogEntry) {
    setLog((l) => {
      const next = [...l, entry];
      requestAnimationFrame(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      });
      return next;
    });
  }

  function handleEvent(event: SendEmailEvent) {
    switch (event.type) {
      case "start":
        setProgress({ sent: 0, failed: 0, total: event.total });
        break;
      case "sent":
        setProgress((p) => ({ ...p, sent: p.sent + 1 }));
        pushLog({ kind: "sent", text: `${event.username}  <${event.email}>` });
        break;
      case "failed":
        setProgress((p) => ({ ...p, failed: p.failed + 1 }));
        pushLog({ kind: "failed", text: `${event.username}  <${event.email}> — ${event.error}` });
        break;
      case "stopped":
        setSendStatus("done");
        setSummary({ ok: true, text: `Stopped — ${event.sent} sent, ${event.failed} failed so far.` });
        break;
      case "done":
        setSendStatus("done");
        setSummary({ ok: event.failed === 0, text: `Sent ${event.sent} · failed ${event.failed}` });
        break;
      case "error":
        setSendStatus("error");
        setSummary({ ok: false, text: event.message });
        break;
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0 || !subject.trim() || !message.trim() || !from.trim() || running) return;

    setLog([]);
    setSummary(null);
    setSendStatus("running");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: [...selected.keys()],
          subject,
          message,
          from,
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        setSendStatus("error");
        setSummary({ ok: false, text: data.error ?? resp.statusText });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          handleEvent(JSON.parse(line));
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setSendStatus("error");
        setSummary({ ok: false, text: "Connection lost before the run finished." });
      }
    } finally {
      abortRef.current = null;
      setSendStatus((s) => (s === "running" ? "done" : s));
      onFinished();
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleGenerate() {
    if (!topicInput.trim() || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const firstSelected = selected.values().next().value;
      const resp = await fetch("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicInput.trim(),
          model: selectedModel || undefined,
          contact: firstSelected
            ? {
                username: firstSelected.username,
                name: firstSelected.name,
                company: firstSelected.company,
                country: firstSelected.country,
                bio: firstSelected.bio,
              }
            : null,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setGenerateError(json.error ?? "Failed to generate draft.");
        return;
      }
      setSubject(json.subject ?? "");
      setMessage(json.message ?? "");
    } catch {
      setGenerateError("Connection lost while generating.");
    } finally {
      setGenerating(false);
    }
  }

  const progressPct = progress.total > 0 ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[160px] flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-sm"
            placeholder="Search username, name, or email"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            disabled={running}
          />
        </div>
        <Input
          className="h-8 w-[140px] text-sm"
          placeholder="Country"
          value={countryInput}
          onChange={(e) => setCountryInput(e.target.value)}
          disabled={running}
        />
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value || "all"}
              type="button"
              size="sm"
              variant={statusFilter === f.value ? "default" : "outline"}
              disabled={running}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAllOnPage} disabled={running || rows.length === 0} />
            select page
          </label>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              {selected.size} selected{data ? ` / ${data.totalMatching} matching` : ""}
            </span>
            <Button type="button" size="xs" variant="outline" disabled={running || !data || data.totalMatching === 0} onClick={selectAllMatching}>
              Select all matching{data && data.totalMatching > MAX_RECIPIENTS ? ` (first ${MAX_RECIPIENTS})` : ""}
            </Button>
            {selected.size > 0 && (
              <Button type="button" size="xs" variant="ghost" disabled={running} onClick={clearSelection}>
                Clear
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[220px]">
          <div className="divide-y">
            {listLoading && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            )}
            {!listLoading && rows.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No contacts match these filters.</div>
            )}
            {!listLoading &&
              rows.map((r) => {
                const badge = STATUS_BADGE[r.email_status] ?? STATUS_BADGE.not_sent;
                return (
                  <label
                    key={r.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/40",
                      running && "pointer-events-none opacity-60"
                    )}
                  >
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r)} disabled={running} />
                    <ContactAvatar url={r.avatar_url} name={r.name || r.username} />
                    <span className="font-medium">{r.username}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.email}</span>
                    {r.country && <span className="hidden shrink-0 text-muted-foreground sm:inline">{r.country}</span>}
                    <Badge variant="outline" className={cn("shrink-0 font-normal", badge.className)}>
                      {badge.label}
                    </Badge>
                  </label>
                );
              })}
          </div>
        </ScrollArea>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
            <Button type="button" variant="ghost" size="icon-xs" disabled={running || page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={13} />
            </Button>
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={running || page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={13} />
            </Button>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-topic">Generate with AI</Label>
            {models.length > 0 && (
              <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as string)} disabled={running || generating}>
                <SelectTrigger size="sm" className="h-7 text-xs">
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="ai-topic"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              placeholder="What's this email about? e.g. invite them to try our open-source SDK"
              disabled={running || generating}
            />
            <Button
              type="button"
              variant="outline"
              disabled={running || generating || !topicInput.trim()}
              onClick={handleGenerate}
            >
              {generating ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={14} />}
              Generate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.size > 0
              ? `Personalizes using ${[...selected.values()][0].username}'s profile, then fills in the subject and message below.`
              : "Select a contact above to personalize the draft, or generate a generic one."}
          </p>
          {modelsError && <p className="text-xs text-muted-foreground">Model list unavailable: {modelsError}</p>}
          {generateError && <p className="text-xs text-destructive">{generateError}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-from">Sender email</Label>
          <Input
            id="send-from"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPrefilledFrom(false);
            }}
            placeholder={domainChecked && !domain ? "you@yourdomain.com" : "outreach@yourdomain.com"}
            disabled={running}
            required
          />
          <p className="text-xs text-muted-foreground">
            {!domainChecked && "Checking Resend for a verified sending domain…"}
            {domainChecked && domain && prefilledFrom && `Using your verified Resend domain (${domain}) — edit freely.`}
            {domainChecked && domain && !prefilledFrom && `Verified domain on file: ${domain}.`}
            {domainChecked && !domain &&
              "No verified domain found on this Resend account — enter the full sender address yourself."}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-subject">Subject</Label>
          <Input id="send-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={running} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="send-message">Message</Label>
          <Textarea
            id="send-message"
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Plain text — line breaks are preserved."
            disabled={running}
            required
          />
        </div>

        {(running || log.length > 0) && (
          <div className="flex items-center gap-3">
            <Progress value={progressPct} className="flex-1" />
            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {progress.sent + progress.failed} / {progress.total || selected.size}
            </span>
          </div>
        )}

        {log.length > 0 && (
          <div ref={logRef} className="max-h-[160px] overflow-y-auto rounded-lg border bg-muted/50 p-2.5 font-mono text-xs">
            {log.map((entry, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 rounded px-3 py-0.5",
                  entry.kind === "sent" ? "text-success" : "text-destructive"
                )}
              >
                <span className="flex w-3.5 shrink-0 items-center justify-center">
                  {entry.kind === "sent" ? <Check size={13} /> : <AlertTriangle size={13} />}
                </span>
                <span className="truncate">{entry.text}</span>
              </div>
            ))}
          </div>
        )}

        {summary && (
          <Alert
            variant={summary.ok ? "default" : "destructive"}
            className={summary.ok ? "border-success/30 bg-success/10" : undefined}
          >
            <AlertDescription className={summary.ok ? "text-success" : undefined}>{summary.text}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          {running && (
            <Button type="button" variant="outline" onClick={handleCancel}>
              Stop
            </Button>
          )}
          <Button type="submit" disabled={running || selected.size === 0 || !subject.trim() || !message.trim() || !from.trim()}>
            {running ? (
              <>
                <Loader2 className="animate-spin" size={15} /> Sending…
              </>
            ) : (
              <>
                <Mail size={14} /> Send to {selected.size || ""}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
