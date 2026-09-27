import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { DashboardView } from "./dashboard";

export default async function DashboardPage() {
  const user = await requireUser();
  if (!can(user.role, "dashboard")) redirect("/");
  return <DashboardView />;
}
