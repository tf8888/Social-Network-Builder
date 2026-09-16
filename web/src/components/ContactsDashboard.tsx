"use client";

import { useEffect, useState } from "react";
import type { ContactsResponse, Contact, EmailStatus } from "@/lib/types";
import ContactFormModal from "./ContactFormModal";
import CollectPanel from "./CollectPanel";
import SendEmailModal from "./SendEmailModal";
import ContactAvatar from "./ContactAvatar";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Download,
  ListFilter,
  Globe,
  Mail,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

const COLUMN_COUNT = 13;

const EMAIL_STATUS_BADGE: Record<EmailStatus, { label: string; className: string }> = {
  not_sent: { label: "New", className: "text-muted-foreground" },
  sent: { label: "Sent", className: "border-success/30 bg-success/10 text-success" },
  failed: { label: "Failed", className: "border-destructive/30 bg-destructive/10 text-destructive" },
};

type StatusFilter = "" | EmailStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "not_sent", label: "New" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title="Copy email"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // clipboard API unavailable — silently ignore, not worth a toast
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </Button>
  );
}

function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {Array.from({ length: COLUMN_COUNT }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-3 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export default function ContactsDashboard() {
  const [qInput, setQInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const q = useDebounced(qInput, 350);
  const country = useDebounced(countryInput, 350);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<Map<string, Contact>>(new Map());
  const [modal, setModal] = useState<{ mode: "create" | "edit"; contact: Contact | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [sendRecipients, setSendRecipients] = useState<Contact[] | null>(null);

  // Reset to page 1 whenever the filter changes, adjusted during render
  // rather than in an effect (React's documented pattern for "resetting
  // state when an input changes") — avoids an extra render-then-fetch cycle.
  const filterKey = `${q}::${country}::${statusFilter}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
    setSelected(new Map());
  }

  const isInitialLoad = loading && data === null;

  function refresh() {
    setReloadToken((t) => t + 1);
  }

  // Standard fetch-in-effect pattern (React docs: "You Might Not Need an
  // Effect" — data fetching example). The new eslint-plugin-react-hooks
  // "set-state-in-effect" rule flags the setLoading/setErrored resets at the
  // top as if unguarded, but they only run once per dependency change here
  // (no external subscription involved), and the `ignore` flag already
  // guards the async completion against races — hence the scoped disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setErrored(false);

    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    if (statusFilter) params.set("emailStatus", statusFilter);

    fetch(`/api/contacts?${params.toString()}`)
      .then((resp) => {
        if (!resp.ok) throw new Error(String(resp.status));
        return resp.json();
      })
      .then((json: ContactsResponse) => {
        if (ignore) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (ignore) return;
        setErrored(true);
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [q, country, statusFilter, page, reloadToken]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hasFilter = Boolean(qInput || countryInput || statusFilter);
  const rows = data?.rows ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

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

  async function deleteIds(ids: string[]) {
    setDeleting(true);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/contacts/${id}`, { method: "DELETE" })));
      setSelected((s) => {
        const next = new Map(s);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  function handleDeleteRow(r: Contact) {
    if (!window.confirm(`Delete ${r.username}? This can't be undone.`)) return;
    deleteIds([r.id]);
  }

  function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} selected contact(s)? This can't be undone.`)) return;
    deleteIds([...selected.keys()]);
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-3.5 py-5">
      <CardHeader className="gap-2">
        <CardTitle>Collected contacts</CardTitle>
        {!noticeDismissed && (
          <Alert className="relative pr-10">
            <AlertDescription>
              Scraped, self-disclosed public profile info. For local/private use — don&apos;t deploy this view
              publicly or share screenshots with real emails.
            </AlertDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-1.5 right-1.5"
              title="Dismiss"
              onClick={() => setNoticeDismissed(true)}
            >
              <X size={13} />
            </Button>
          </Alert>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-3.5 rounded-lg border bg-muted/40 px-3.5 py-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Users size={14} className="text-primary" />
            <strong className="text-sm font-semibold text-foreground">{data?.totalAll ?? "—"}</strong> total
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <ListFilter size={14} className="text-primary" />
            <strong className="text-sm font-semibold text-foreground">{data?.totalMatching ?? "—"}</strong> matching
          </span>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Globe size={14} className="shrink-0 text-primary" />
            <div className="chips-scroll flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
              {(!data || data.topCountries.length === 0) && (
                <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                  no country data yet
                </Badge>
              )}
              {data?.topCountries.map(([name, count]) => (
                <Badge key={name} variant="outline" className="shrink-0 font-normal text-muted-foreground">
                  {name} · {count}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search username, name, or email"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
          <div className="relative w-[140px] flex-none">
            <Globe size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Country"
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value || "all"}
                type="button"
                size="sm"
                variant={statusFilter === f.value ? "default" : "outline"}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {hasFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQInput("");
                setCountryInput("");
                setStatusFilter("");
              }}
            >
              <X size={13} /> Clear
            </Button>
          )}

          <div className="flex-1" />

          {selected.size > 0 && (
            <Button type="button" variant="destructive" size="sm" disabled={deleting} onClick={handleDeleteSelected}>
              <Trash2 size={13} /> Delete selected ({selected.size})
            </Button>
          )}
          {selected.size > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSendRecipients([...selected.values()])}>
              <Mail size={14} /> Send email ({selected.size})
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setCollectOpen(true)}>
            <Download size={14} /> Collect
          </Button>
          <Button type="button" size="sm" onClick={() => setModal({ mode: "create", contact: null })}>
            <Plus size={14} /> New user
          </Button>
        </div>

        <div className="min-h-[120px] flex-1 overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-9">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAllOnPage}
                    aria-label="Select all on page"
                  />
                </TableHead>
                <TableHead></TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Email status</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Portfolio</TableHead>
                <TableHead>Repos</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>GH Exp</TableHead>
                <TableHead>Collected</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoad && <SkeletonRows />}
              {!loading && errored && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMN_COUNT} className="py-10 text-center whitespace-normal text-muted-foreground">
                    Couldn&apos;t load contacts — check the dev server console for details.
                  </TableCell>
                </TableRow>
              )}
              {!loading && !errored && data && data.rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMN_COUNT} className="py-10 text-center whitespace-normal text-muted-foreground">
                    {hasFilter ? "No contacts match this filter." : "No contacts yet — click Collect above, or add one manually."}
                  </TableCell>
                </TableRow>
              )}
              {!errored &&
                data &&
                data.rows.length > 0 &&
                data.rows.map((r: Contact) => (
                  <TableRow key={r.id} style={loading ? { opacity: 0.5 } : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleOne(r)}
                        aria-label={`Select ${r.username}`}
                      />
                    </TableCell>
                    <TableCell>
                      <ContactAvatar url={r.avatar_url} name={r.name || r.username} />
                    </TableCell>
                    <TableCell>
                      <a
                        className="text-primary hover:underline"
                        href={`https://github.com/${r.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {r.username}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.name || "—"}</TableCell>
                    <TableCell>
                      {r.email ? (
                        <div className="flex items-center gap-1.5">
                          <span>{r.email}</span>
                          <CopyButton value={r.email} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("font-normal", EMAIL_STATUS_BADGE[r.email_status].className)}>
                        {EMAIL_STATUS_BADGE[r.email_status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.country || "—"}</TableCell>
                    <TableCell>
                      {r.portfolio_url ? (
                        <a
                          className="text-primary hover:underline"
                          href={r.portfolio_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          link
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.public_repos ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.followers ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.github_experience_years ?? "—"}y</TableCell>
                    <TableCell className="text-muted-foreground">{r.collected_at?.slice(0, 10) || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Send email"
                          disabled={!r.email}
                          onClick={() => setSendRecipients([r])}
                        >
                          <Mail size={13} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Edit"
                          onClick={() => setModal({ mode: "edit", contact: r })}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => handleDeleteRow(r)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3.5 text-sm text-muted-foreground">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={15} /> Prev
            </Button>
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight size={15} />
            </Button>
          </div>
        )}
      </CardContent>

      {modal && (
        <ContactFormModal mode={modal.mode} initial={modal.contact} onClose={() => setModal(null)} onSaved={refresh} />
      )}

      <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Collect contacts</DialogTitle>
            <DialogDescription>Only users with a public profile email are stored, capped at 50 per run.</DialogDescription>
          </DialogHeader>
          <CollectPanel onFinished={refresh} />
        </DialogContent>
      </Dialog>

      {sendRecipients && (
        <Dialog open onOpenChange={(open) => !open && setSendRecipients(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Send email</DialogTitle>
              <DialogDescription>Compose a message and send it via Resend.</DialogDescription>
            </DialogHeader>
            <SendEmailModal
              recipients={sendRecipients}
              onFinished={() => {
                refresh();
                setSelected((s) => {
                  const next = new Map(s);
                  sendRecipients.forEach((r) => next.delete(r.id));
                  return next;
                });
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
