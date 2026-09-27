import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { beginConnect, CONNECT_COOKIE, getApp } from "@/server/scm/app-connect";
import { publicBaseUrl } from "@/server/url";

const query = z.object({
  name: z.string().trim().max(100).default(""),
  orgUrl: z.string().trim().url().optional(),
  install: z.enum(["1", "0"]).optional(),
});

/** Starts connecting through an app registration (browser navigation, not fetch). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = publicBaseUrl(req);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  const back = (msg: string) => NextResponse.redirect(`${base}/settings?connectError=${encodeURIComponent(msg)}`);
  try {
    const app = await getApp(id);
    const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
    if (app.kind === "entra_devops" && !q.orgUrl) return back("Enter the Azure DevOps organization URL");
    const { url, cookie } = beginConnect(app, user.id, base, { name: q.name, orgUrl: q.orgUrl, install: q.install === "1" });
    const res = NextResponse.redirect(url);
    res.cookies.set(CONNECT_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: `/api/code-host-apps/${id}`, maxAge: 900 });
    return res;
  } catch (err) {
    return back(err instanceof Error ? err.message : String(err));
  }
}
