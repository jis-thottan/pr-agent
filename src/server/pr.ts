import "server-only";

export type PrParams = { connId: string; owner: string; repo: string; number: string };
export type PrCtx = { params: Promise<PrParams> };

export async function prParams(params: Promise<PrParams>) {
  const p = await params;
  const number = Number(p.number);
  if (!Number.isInteger(number) || number <= 0) throw new Error("Invalid PR number");
  return { ...p, number, prKey: `${p.owner}/${p.repo}#${number}` };
}
