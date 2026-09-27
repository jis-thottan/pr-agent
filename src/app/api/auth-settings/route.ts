import { z } from "zod";
import { audit, route } from "@/server/http";
import { getAuthSettings, setAuthSettings } from "@/server/auth/settings";

export const GET = route(async () => getAuthSettings(), { perm: "manageUsers" });

export const PUT = route(async (req, { user }) => {
  const input = z.object({ localLogin: z.boolean() }).parse(await req.json());
  await setAuthSettings(input);
  await audit(user.id, "auth.settings", input);
}, { perm: "manageUsers" });
