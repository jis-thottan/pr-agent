import { requireUser } from "@/server/auth/session";
import { ConnectionsSection } from "./connections";
import { ProvidersSection } from "./providers";

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Connect code hosts and configure the AI models used for reviews.</p>
      </div>
      <ConnectionsSection />
      <ProvidersSection isAdmin={user.role === "admin"} />
    </main>
  );
}
