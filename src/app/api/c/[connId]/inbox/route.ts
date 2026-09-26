import { route } from "@/server/http";
import { getConnection } from "@/server/scm";

export const GET = route<{ params: Promise<{ connId: string }> }>(async (_req, { user, params }) => {
  const { connId } = await params;
  const { scm } = await getConnection(user.id, connId);
  return { pulls: await scm.listReviewRequests() };
});
