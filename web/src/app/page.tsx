import ContactsDashboard from "@/components/ContactsDashboard";
import LogoutButton from "@/components/LogoutButton";

export default function Home() {
  return (
    <main className="app-shell mx-auto flex max-w-full flex-col gap-3.5 px-5 pt-5 pb-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">GitHub Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Portfolio ETL demo — collect &amp; browse public GitHub profiles
          </p>
        </div>
        <LogoutButton />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5">
        <ContactsDashboard />
      </div>
    </main>
  );
}
