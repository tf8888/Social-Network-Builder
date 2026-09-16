"use client";

import { useEffect, useRef, useState } from "react";
import type { Contact, SendEmailEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import ContactAvatar from "./ContactAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, Loader2, Mail, Sparkles, X } from "lucide-react";

type LogEntry = { kind: "sent" | "failed"; text: string };
type SendStatus = "idle" | "running" | "done" | "error";

export default function SendEmailModal({
  recipients,
  onFinished,
}: {
  recipients: Contact[];
  onFinished: () => void;
}) {
  // Recipients are chosen beforehand (dashboard selection, or a single row's
  // "Send email" button) — this modal is compose-only. A local copy lets the
  // user drop someone from this particular send without touching that
  // upstream selection.
  const [localRecipients, setLocalRecipients] = useState<Contact[]>(recipients);

  // Sender domain lookup
  const [domain, setDomain] = useState<string | null>(null);
  const [domainChecked, setDomainChecked] = useState(false);

  // Compose fields
  const [senderName, setSenderName] = useState("");
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

  const running = sendStatus === "running";

  function removeRecipient(id: string) {
    setLocalRecipients((r) => r.filter((c) => c.id !== id));
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

  // "Name <email>" when a sender name is given (RFC 5322, what Resend
  // expects for a display name) — just the bare address otherwise.
  function composeFrom() {
    const email = from.trim();
    const name = senderName.trim();
    return name ? `${name} <${email}>` : email;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (localRecipients.length === 0 || !subject.trim() || !message.trim() || !from.trim() || running) return;

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
          contactIds: localRecipients.map((r) => r.id),
          subject,
          message,
          from: composeFrom(),
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
      const firstRecipient = localRecipients[0];
      const resp = await fetch("/api/email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicInput.trim(),
          model: selectedModel || undefined,
          senderName: senderName.trim() || undefined,
          contact: firstRecipient
            ? {
                username: firstRecipient.username,
                name: firstRecipient.name,
                company: firstRecipient.company,
                country: firstRecipient.country,
                bio: firstRecipient.bio,
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
      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {localRecipients.length} recipient{localRecipients.length === 1 ? "" : "s"}
          </span>
        </div>
        {(() => {
          const rows =
            localRecipients.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No recipients left — close this and reselect contacts to send.
              </div>
            ) : (
              localRecipients.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <ContactAvatar url={r.avatar_url} name={r.name || r.username} />
                  <span className="font-medium">{r.username}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.email}</span>
                  {r.country && <span className="hidden shrink-0 text-muted-foreground sm:inline">{r.country}</span>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Remove from this send"
                    disabled={running}
                    onClick={() => removeRecipient(r.id)}
                  >
                    <X size={13} />
                  </Button>
                </div>
              ))
            );

          // Base UI's ScrollArea viewport needs a *definite* height to
          // actually constrain and scroll — max-height alone leaves it
          // sized to content, so the list spills over the rest of the form
          // instead of scrolling. Only pay that fixed-height cost (and the
          // empty space it leaves for a short list) once there's enough
          // recipients to actually need scrolling.
          return localRecipients.length > 6 ? (
            <ScrollArea className="h-[220px]">
              <div className="divide-y">{rows}</div>
            </ScrollArea>
          ) : (
            <div className="divide-y">{rows}</div>
          );
        })()}
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
            {localRecipients.length > 0
              ? `Personalizes using ${localRecipients[0].username}'s profile, then fills in the subject and message below.`
              : "Generates a generic draft — no recipients left to personalize with."}
          </p>
          {modelsError && <p className="text-xs text-muted-foreground">Model list unavailable: {modelsError}</p>}
          {generateError && <p className="text-xs text-destructive">{generateError}</p>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-sender-name">Sender name</Label>
            <Input
              id="send-sender-name"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              disabled={running}
            />
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
          </div>
        </div>
        <p className="-mt-1.5 text-xs text-muted-foreground">
          {!domainChecked && "Checking Resend for a verified sending domain…"}
          {domainChecked && domain && prefilledFrom && `Using your verified Resend domain (${domain}) — edit freely.`}
          {domainChecked && domain && !prefilledFrom && `Verified domain on file: ${domain}.`}
          {domainChecked && !domain &&
            "No verified domain found on this Resend account — enter the full sender address yourself."}
        </p>
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
              {progress.sent + progress.failed} / {progress.total || localRecipients.length}
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
          <Button
            type="submit"
            disabled={running || localRecipients.length === 0 || !subject.trim() || !message.trim() || !from.trim()}
          >
            {running ? (
              <>
                <Loader2 className="animate-spin" size={15} /> Sending…
              </>
            ) : (
              <>
                <Mail size={14} /> Send to {localRecipients.length || ""}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
