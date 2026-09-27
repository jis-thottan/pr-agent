import { HttpError, route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { loadRepoRules } from "@/server/review/rules-loader";

type Ctx = { params: Promise<{ connId: string; owner: string; repo: string }> };

/** The repository's .pr-review.yml at `ref` (the PR's base commit), for the run dialog preview. */
export const GET = route<Ctx>(async (req, { user, params }) => {
  const { connId, owner, repo } = await params;
  const ref = new URL(req.url).searchParams.get("ref");
  if (!ref) throw new HttpError(400, "ref is required");
  const { scm } = await getConnection(user.id, connId);
  return { rules: await loadRepoRules(scm, owner, repo, ref) };
});
