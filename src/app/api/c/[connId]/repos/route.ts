import { route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { cached } from "@/server/cache";

export const GET = route<{ params: Promise<{ connId: string }> }>(async (req, { user, params }) => {
  const { connId } = await params;
  const { scm } = await getConnection(user.id, connId);
  const refresh = new URL(req.url).searchParams.has("refresh");
  return { repos: await cached(`repos:${connId}`, 5 * 60_000, () => scm.listRepos(), refresh) };
});
