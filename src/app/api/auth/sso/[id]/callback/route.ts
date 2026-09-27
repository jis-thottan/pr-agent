import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/server/auth/session";
import { completeSso, SSO_COOKIE, ssoRedirectUri } from "@/server/auth/sso";
import { enabledSsoProvider, loginErrorRedirect } from "@/server/auth/sso-route";
import { audit } from "@/server/http";
import { publicBaseUrl } from "@/server/url";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = publicBaseUrl(req);
  const jar = await cookies();
  const flowCookie = jar.get(SSO_COOKIE)?.value;
  jar.delete({ name: SSO_COOKIE, path: "/api/auth/sso" });
  const provider = await enabledSsoProvider(id);
  if (!provider) return NextResponse.redirect(loginErrorRedirect(base, "That sign-in option is not available"));
  try {
    const { userId, next } = await completeSso(provider, new URL(req.url).searchParams, flowCookie, ssoRedirectUri(base, id));
    await createSession(userId);
    await audit(userId, "user.login", { via: provider.name });
    return NextResponse.redirect(`${base}${next}`);
  } catch (err) {
    console.warn("[pr-review-ai] SSO sign-in failed", err);
    await audit(null, "user.login_failed", { via: provider.name, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.redirect(loginErrorRedirect(base, err instanceof Error ? err.message : String(err)));
  }
}
