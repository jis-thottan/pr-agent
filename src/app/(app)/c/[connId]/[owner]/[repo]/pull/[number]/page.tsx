import { ReviewWorkspace } from "@/components/review/workspace";

export default async function PullPage({ params }: { params: Promise<{ connId: string; owner: string; repo: string; number: string }> }) {
  const p = await params;
  return <ReviewWorkspace connId={p.connId} owner={p.owner} repo={p.repo} number={p.number} />;
}
