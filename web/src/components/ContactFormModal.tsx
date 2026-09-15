"use client";

import { useState } from "react";
import type { Contact, NewContactInput } from "@/lib/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Props {
  mode: "create" | "edit";
  initial?: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}

const FIELDS: { key: keyof NewContactInput; label: string; textarea?: boolean }[] = [
  { key: "username", label: "Username *" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "country", label: "Country" },
  { key: "portfolio_url", label: "Portfolio URL" },
  { key: "company", label: "Company" },
  { key: "bio", label: "Bio", textarea: true },
];

export default function ContactFormModal({ mode, initial, onClose, onSaved }: Props) {
  const [values, setValues] = useState<NewContactInput>({
    username: initial?.username ?? "",
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    country: initial?.country ?? "",
    portfolio_url: initial?.portfolio_url ?? "",
    company: initial?.company ?? "",
    bio: initial?.bio ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.username?.trim()) {
      setError("Username is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === "create" ? "/api/contacts" : `/api/contacts/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(json.error ?? "Save failed");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New contact" : `Edit ${initial?.username}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              {f.textarea ? (
                <Textarea
                  id={f.key}
                  rows={3}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={f.key}
                  type="text"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
