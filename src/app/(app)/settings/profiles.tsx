"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi, type AiProviderInfo, type ReviewProfileInfo } from "@/lib/hooks";
import { ProfileForm } from "@/components/profile-form";
import { Badge, Button, Card, Empty, ErrorNote, Spinner } from "@/components/ui";

export function ProfilesSection({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const { data, loading, error, reload } = useApi<{ profiles: ReviewProfileInfo[] }>("/api/profiles");
  const providers = useApi<{ providers: AiProviderInfo[] }>("/api/ai-providers");
  const [editing, setEditing] = useState<ReviewProfileInfo | "new" | null>(null);
  const providerName = (id: string | null) => (id ? (providers.data?.providers.find((p) => p.id === id)?.name ?? "deleted provider") : "default provider");

  return (
    <Card title="Review profiles" actions={<Button size="sm" variant="primary" onClick={() => setEditing("new")}>New profile</Button>}>
      <ErrorNote error={error} />
      {loading && !data ? (
        <div className="p-6 text-center"><Spinner /></div>
      ) : !data?.profiles.length ? (
        <Empty title="No review profiles yet">
          Save a model, review focus, files to skip and a severity threshold as a profile, then pick it when you run a review. Shared profiles are available to everyone.
        </Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.profiles.map((p) => {
            const canEdit = p.userId === userId || isAdmin;
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {p.name}
                    {p.shared && <Badge tone="accent">shared</Badge>}
                    {p.minSeverity && <Badge tone="muted">{p.minSeverity}+</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {p.description || p.instructions?.split("\n")[0] || "No instructions"} · {providerName(p.providerId)}
                    {p.userId !== userId && <> · by {p.ownerName}</>}
                  </div>
                </div>
                {canEdit && (
                  <>
                    <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Delete profile "${p.name}"?`)) return;
                        await api(`/api/profiles/${p.id}`, { method: "DELETE" });
                        reload();
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ProfileForm
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}
