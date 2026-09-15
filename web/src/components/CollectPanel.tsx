"use client";

import { useRef, useState } from "react";
import type { CollectEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Check, Loader2, SkipForward } from "lucide-react";

type LogEntry = { kind: "info" | "stored" | "skip" | "error"; text: string };
type Status = "idle" | "running" | "stopped" | "done" | "error";

const EXAMPLES = [
  "location:kenya language:go",
  "location:brazil topic:machine-learning",
  "location:berlin language:rust",
];

const LOG_COLOR: Record<LogEntry["kind"], string> = {
  info: "text-muted-foreground",
  stored: "text-success",
  skip: "text-muted-foreground",
  error: "text-destructive",
};

export default function CollectPanel({ onFinished }: { onFinished: () => void }) {
  const [keywords, setKeywords] = useState("");
  const [maxUsers, setMaxUsers] = useState(10);
  const [status, setStatus] = useState<Status>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<{ ok: boolean; text: string } | null>(null);
  const [stored, setStored] = useState(0);
  const [cap, setCap] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false); // guards against overlapping stream reads

  function pushLog(entry: LogEntry) {
    setLog((l) => {
      const next = [...l, entry];
      requestAnimationFrame(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      });
      return next;
    });
  }

  function handleEvent(event: CollectEvent) {
    switch (event.type) {
      case "start":
        setJobId(event.jobId);
        setCap(event.cap);
        setStored(0);
        pushLog({ kind: "info", text: `Starting — ${event.keywords.join(", ")} (cap ${event.cap})` });
        break;
      case "resumed":
        setJobId(event.jobId);
        setCap(event.cap);
        setStored(event.stored);
        pushLog({ kind: "info", text: `Resuming — ${event.stored}/${event.cap} already stored` });
        break;
      case "searching":
        pushLog({ kind: "info", text: `Searching "${event.keyword}"…` });
        break;
      case "stored":
        setStored((s) => s + 1);
        pushLog({ kind: "stored", text: `${event.username}  <${event.email}>` });
        break;
      case "skip_no_email":
        pushLog({ kind: "skip", text: `${event.username} — no public email` });
        break;
      case "skip_duplicate_email":
        pushLog({ kind: "skip", text: `${event.username} — duplicate email` });
        break;
      case "stopped":
        setStatus("stopped");
        pushLog({ kind: "info", text: `Stopped — ${event.stored} stored so far` });
        break;
      case "done":
        setStatus("done");
        setSummary({
          ok: true,
          text: `Stored ${event.stored} · skipped ${event.skippedNoEmail} (no email), ${event.skippedDuplicate} (duplicate)`,
        });
        break;
      case "error":
        setStatus("error");
        pushLog({ kind: "error", text: event.message });
        setSummary({ ok: false, text: event.message });
        break;
    }
  }

  async function consumeStream(resp: Response) {
    if (!resp.ok || !resp.body) {
      const data = await resp.json().catch(() => ({}));
      setStatus("error");
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
  }

  async function runStream(resp: Response) {
    busyRef.current = true;
    setStatus("running");
    try {
      await consumeStream(resp);
    } catch {
      setStatus("error");
      setSummary({ ok: false, text: "Connection lost before the run finished." });
    } finally {
      busyRef.current = false;
      setStatus((s) => (s === "running" ? "done" : s));
      onFinished();
    }
  }

  async function handleStart(e?: React.FormEvent) {
    e?.preventDefault();
    const keywordList = keywords
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywordList.length === 0 || busyRef.current) return;

    setLog([]);
    setSummary(null);
    setJobId(null);

    const resp = await fetch("/api/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: keywordList, maxUsers }),
    });
    await runStream(resp);
  }

  async function handleStop() {
    if (!jobId) return;
    await fetch("/api/collect/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, action: "stop" }),
    });
    // The still-open stream (in handleStart/handleResume's runStream) will
    // see the flag, emit "stopped", and update status itself.
  }

  async function handleResume() {
    if (!jobId || busyRef.current) return;
    const resp = await fetch("/api/collect/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    await runStream(resp);
  }

  async function handleRestart() {
    if (status === "running") {
      await handleStop();
    }
    await handleStart();
  }

  const progressPct = cap > 0 ? Math.min(100, Math.round((stored / cap) * 100)) : 0;
  const running = status === "running";
  const canResume = status === "stopped" && Boolean(jobId);
  const canRestart = Boolean(jobId);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleStart} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="collect-keywords">
            Search keywords{" "}
            <span className="font-normal text-muted-foreground">
              — one per line, GitHub search qualifiers allowed
            </span>
          </Label>
          <Textarea
            id="collect-keywords"
            className="font-mono text-sm"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            rows={3}
            placeholder={"location:portland language:python\ntopic:machine-learning"}
            disabled={running}
            required
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <Button
              type="button"
              key={ex}
              variant="outline"
              size="sm"
              className="border-dashed font-mono text-xs text-muted-foreground"
              disabled={running}
              onClick={() => setKeywords((k) => (k ? `${k}\n${ex}` : ex))}
            >
              + {ex}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3.5">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <Label>Max users</Label>
            <div className="flex items-center gap-2.5">
              <Slider
                value={maxUsers}
                min={1}
                max={50}
                disabled={running}
                onValueChange={(v) => setMaxUsers(Array.isArray(v) ? v[0] : v)}
                className="flex-1"
              />
              <span className="min-w-[2ch] text-right text-sm font-semibold tabular-nums">{maxUsers}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={running || !keywords.trim()}>
              {running ? (
                <>
                  <Loader2 className="animate-spin" size={15} /> Running…
                </>
              ) : (
                "Start"
              )}
            </Button>
            <Button type="button" variant="outline" disabled={!running} onClick={handleStop}>
              Stop
            </Button>
            <Button type="button" variant="outline" disabled={!canResume} onClick={handleResume}>
              Resume
            </Button>
            <Button type="button" variant="outline" disabled={!canRestart} onClick={handleRestart}>
              Restart
            </Button>
          </div>
        </div>
      </form>

      {(running || log.length > 0) && (
        <div className="flex items-center gap-3">
          <Progress value={progressPct} className="flex-1" />
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {stored} / {cap || "?"} stored
          </span>
        </div>
      )}

      {log.length > 0 && (
        <div ref={logRef} className="max-h-[220px] overflow-y-auto rounded-lg border bg-muted/50 p-2.5 font-mono text-xs">
          {log.map((entry, i) => (
            <div key={i} className={cn("flex items-center gap-2 rounded px-3 py-0.5", LOG_COLOR[entry.kind])}>
              <span className="flex w-3.5 shrink-0 items-center justify-center">
                {entry.kind === "stored" && <Check size={13} />}
                {entry.kind === "skip" && <SkipForward size={13} />}
                {entry.kind === "error" && <AlertTriangle size={13} />}
                {entry.kind === "info" && "›"}
              </span>
              <span>{entry.text}</span>
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
    </div>
  );
}
