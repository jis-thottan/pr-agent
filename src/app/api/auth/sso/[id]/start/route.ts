import { NextResponse } from "next/server";
import { beginSso, SSO_COOKIE, ssoRedirectUri } from "@/server/auth/sso";
import { enabledSsoProvider, loginErrorRedirect } from "@/server/auth/sso-route";
import { publicBaseUrl } from "@/server/url";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = publicBaseUrl(req);
  const provider = await enabledSsoProvider(id);
  if (!provider) return NextResponse.redirect(loginErrorRedirect(base, "That sign-in option is not available"));
  try {
    const next = new URL(req.url).searchParams.get("next") ?? "/";
    const { url, cookie } = await beginSso(provider, ssoRedirectUri(base, id), next);
    const res = NextResponse.redirect(url);
    res.cookies.set(SSO_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/api/auth/sso",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    return NextResponse.redirect(loginErrorRedirect(base, err instanceof Error ? err.message : String(err)));
  }
}
