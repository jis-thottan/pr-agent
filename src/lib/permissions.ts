// Role → permission map, shared by the API (enforcement) and the UI (hiding what you can't use).

export type Role = "admin" | "lead" | "reviewer" | "viewer";

export const PERMISSIONS = {
  /** Browse repositories and PRs, read reviews and the diff. */
  read: ["admin", "lead", "reviewer", "viewer"],
  /** Run AI reviews, chat, write comments, edit findings. */
  review: ["admin", "lead", "reviewer"],
  /** Post reviews to the code host. */
  post: ["admin", "lead", "reviewer"],
  /** Webhook-triggered automatic reviews. */
  autoReview: ["admin", "lead", "reviewer"],
  /** Create profiles visible to everyone, and edit other people's shared profiles. */
  shareProfiles: ["admin", "lead"],
  /** Team dashboard. */
  dashboard: ["admin", "lead"],
  /** Audit log. */
  audit: ["admin", "lead"],
  /** AI providers, prices and provider budgets. */
  manageProviders: ["admin"],
  /** Per-user budget limit. */
  manageBudgets: ["admin"],
  /** Users, roles, SSO and code-host apps. */
  manageUsers: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | string | null | undefined, perm: Permission): boolean {
  return Boolean(role && (PERMISSIONS[perm] as readonly string[]).includes(role));
}

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  admin: { label: "Admin", description: "Everything, including users, SSO, AI providers and budgets." },
  lead: { label: "Lead", description: "Reviewer, plus the team dashboard, the audit log and shared profiles." },
  reviewer: { label: "Reviewer", description: "Run AI reviews, chat about PRs and post reviews." },
  viewer: { label: "Viewer", description: "Read-only: browse PRs and read reviews. Can't run AI or post." },
};
