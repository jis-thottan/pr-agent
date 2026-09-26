import { route } from "@/server/http";
import { getConnection } from "@/server/scm";

type Ctx = { params: Promise<{ connId: string; owner: string; repo: string }> };

export const GET = route<Ctx>(async (req, { user, params }) => {
  const { connId, owner, repo } = await params;
  const s = new URL(req.url).searchParams.get("state");
  const state = s === "closed" || s === "all" ? s : "open";
  const { scm } = await getConnection(user.id, connId);
  return { pulls: await scm.listPulls(owner, repo, state) };
});
