import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { ConnectionsSection } from "./connections";
import { ProvidersSection } from "./providers";
import { ProfilesSection } from "./profiles";
import { AutoReviewsSection } from "./auto-reviews";
import { UsageSection } from "./usage";
import { SsoSection, UsersSection } from "./access";
import { CodeHostAppsSection } from "./code-host-apps";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const q = await searchParams;
  const admin = can(user.role, "manageUsers");
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Connect code hosts, configure AI models, save review profiles, set up automatic reviews and track spending.</p>
      </div>
      <ConnectionsSection connectError={q.connectError ?? null} connected={q.connected != null ? Number(q.connected) : null} />
      <ProvidersSection isAdmin={can(user.role, "manageProviders")} />
      {can(user.role, "review") && <ProfilesSection userId={user.id} canShare={can(user.role, "shareProfiles")} />}
      {can(user.role, "autoReview") && <AutoReviewsSection />}
      <UsageSection isAdmin={can(user.role, "manageBudgets")} />
      {admin && (
        <>
          <h2 className="pt-4 text-lg font-semibold">Administration</h2>
          <UsersSection currentUserId={user.id} />
          <SsoSection />
          <CodeHostAppsSection />
        </>
      )}
    </main>
  );
}
