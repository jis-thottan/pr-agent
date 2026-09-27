import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { AuditView } from "./audit-view";

export default async function AuditPage() {
  const user = await requireUser();
  if (!can(user.role, "audit")) redirect("/");
  return <AuditView />;
}
