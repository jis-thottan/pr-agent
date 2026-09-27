import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth/session";
import { CONNECT_COOKIE, finishConnect, getApp } from "@/server/scm/app-connect";
import { publicBaseUrl } from "@/server/url";

/** Redirect target for the GitHub App (setup + OAuth callback URL) and the Entra app registration. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = publicBaseUrl(req);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${base}/login?next=/settings`);
  const jar = await cookies();
  const cookie = jar.get(CONNECT_COOKIE)?.value;
  jar.delete({ name: CONNECT_COOKIE, path: `/api/code-host-apps/${id}` });
  try {
    const app = await getApp(id);
    const created = await finishConnect(app, user.id, cookie, new URL(req.url).searchParams, base);
    return NextResponse.redirect(`${base}/settings?connected=${created}`);
  } catch (err) {
    console.warn("[pr-review-ai] app connect failed", err);
    return NextResponse.redirect(`${base}/settings?connectError=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
}
