"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

// Always rendered — harmless if the access-code gate (src/lib/auth.ts)
// isn't configured, since /login then just bounces back into the app.
export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground">
      <LogOut size={14} /> Log out
    </Button>
  );
}
