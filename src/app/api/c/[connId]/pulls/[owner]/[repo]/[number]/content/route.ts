import { HttpError, route } from "@/server/http";
import { getConnection } from "@/server/scm";
import { prParams, type PrCtx } from "@/server/pr";

/** Full file content at a ref (used for the "full file" view). */
export const GET = route<PrCtx>(async (req, { user, params }) => {
  const { connId, owner, repo } = await prParams(params);
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const ref = url.searchParams.get("ref");
  if (!path || !ref) throw new HttpError(400, "path and ref are required");
  const { scm } = await getConnection(user.id, connId);
  const content = await scm.getFileContent(owner, repo, path, ref);
  if (content === null) throw new HttpError(404, "File not found at that commit");
  return { content };
});
