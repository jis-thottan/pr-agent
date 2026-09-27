# PR Review AI

A self-hosted web app for tech leads to review pull requests with AI. The AI drafts the review, and you decide what gets posted.

- Browse the repositories and PRs your **GitHub** and **Azure DevOps** accounts can access, and see every changed file in a code-review diff viewer.
- Run an AI review against **any OpenAI-compatible endpoint**, such as a local model (Ollama, LM Studio, vLLM, LocalAI, llama.cpp) or a cloud provider (OpenAI, AI Foundry, OpenRouter, Groq and others). Anthropic, Google Gemini and Azure OpenAI can also be used through their **native APIs**.
- Save your review settings as **profiles**, and keep team-wide rules in a **`.pr-review.yml`** file in the repository.
- Get **automatic draft reviews** from webhooks when PRs are opened or updated. After a push, only the changed files are re-reviewed.
- **Ask questions about a PR** in a chat grounded in its diff and findings, and keep spending in check with per-provider and per-user **budgets**.
- Run it for a team: **single sign-on** (Microsoft Entra ID, Google, GitHub, any OIDC provider), **roles**, a **team dashboard**, an **audit log**, and app-based connections (**GitHub App**, **Microsoft sign-in for Azure DevOps**) instead of personal tokens.
- Accept, edit or dismiss each finding, add your own line comments and suggestions, then post one grouped review (inline comments, a summary, and Approve / Comment / Request changes) back to the PR.

> Supported code hosts: GitHub (github.com and Enterprise Server) and Azure DevOps (Services and Server). See the [Roadmap](#roadmap) for what's next.

---

## Quick start

### Single container (embedded database)

```bash
docker build -t pull-request-ai .
docker run -d --name prai -p 3000:3000 \
  -e MASTER_KEY="$(openssl rand -base64 32)" \
  -v prai-data:/data \
  pull-request-ai
```

Open http://localhost:3000. The first account you create becomes the **admin**.

Without `DATABASE_URL`, the app uses an embedded PGlite database (Postgres compiled to WASM) stored in `/data`. This is fine for one person or for trying the app out. Use Postgres for teams.

> Save the `MASTER_KEY`. It encrypts every stored token and API key, and those credentials can't be decrypted without it.

### Team setup (Postgres, optional Ollama)

```bash
cp .env.example .env            # then set MASTER_KEY
docker compose up -d            # app + Postgres

# optional: a local model in the same stack
docker compose --profile ollama up -d
docker compose exec ollama ollama pull qwen2.5-coder:14b
```

### First-time setup in the UI

1. **Settings → AI providers → Add provider.** Pick a preset, set the model, then click **Test connection**.
   - Compose Ollama: `http://ollama:11434/v1`
   - Ollama or LM Studio on the host: `http://host.docker.internal:11434/v1` or `:1234/v1`
2. **Settings → Code host connections → Add connection.** Paste a GitHub or Azure DevOps token. You can add several accounts, organizations and Enterprise servers.
3. Open a PR from **Inbox** (PRs where your review is requested) or **Repositories**, then click **✦ Run AI review**.

## Token permissions

Personal access tokens are the quickest way to connect. For teams, see [Code host apps](#code-host-apps-github-app-and-microsoft-sign-in), which avoid long-lived personal tokens.

### GitHub

| Token type | Permissions |
|---|---|
| Fine-grained PAT (recommended) | Repository access: the repos you review. **Pull requests: Read & write**, **Contents: Read**, **Metadata: Read** |
| Classic PAT | `repo` (plus `read:org` to list organization repositories) |

For GitHub Enterprise Server, tick *GitHub Enterprise Server* and use `https://<host>/api/v3`.

### Azure DevOps

Create a personal access token with **Code: Read & write** and **Project and Team: Read**. For the organization URL, use `https://dev.azure.com/<org>` (or `https://<org>.visualstudio.com`). For Azure DevOps Server, use the collection URL, such as `https://tfs.example.com/tfs/DefaultCollection`.

Azure DevOps works a little differently from GitHub:

- Repositories appear as `project/repository`.
- The **Inbox** lists active PRs where you are a reviewer and haven't voted yet. Reviews requested from a team you belong to aren't included.
- Azure DevOps doesn't return patches, so the app computes each file's diff against the merge base, the same comparison as the Azure DevOps *Files* tab. Files over 1.5 MB, binary files, and files beyond the first 1,000 in a PR are listed without a diff.
- Azure DevOps has no single "review" object. **Submit review** posts each inline comment as its own thread and the summary as a general thread, then sets your vote. *Approve* votes Approve, and *Wait for author* votes Wait for author and leaves the summary thread active. *Comment* posts the threads without changing your vote. The summary thread is posted as resolved unless you choose *Wait for author*, so it doesn't block merges under a "resolve all comments" policy. If Azure DevOps rejects an inline comment, it is added to the summary instead.

Each user's connections are private to that user. Tokens are encrypted at rest with AES-256-GCM.

## How a review works

```
PR files ─► repository rules (.pr-review.yml on the target branch)
         ─► filter (lockfiles, generated, binary, deleted, your globs, the repo's globs)
         ─► optional full-file context (when it fits)
         ─► secret masking (for providers not marked "local")
         ─► batches sized to the model's context window (large files split by hunk)
         ─► per-batch review → JSON findings (validated; one repair retry)
         ─► line numbers snapped to commentable diff lines, paths resolved, duplicates removed
         ─► findings below the severity threshold dropped
         ─► summary pass → walkthrough, risk level, suggested verdict
```

- Every diff line is sent with its new-file line number, so findings land on the right line.
- Findings on lines outside the diff go in the summary instead of failing the GitHub API call.
- A review with any **critical** finding never suggests *Approve*.
- Nothing is posted until you click **Submit review**. Only findings you **accepted** are posted. Edited findings count as accepted.
- If new commits are pushed after a review, the workspace warns you. Comments stay anchored to the reviewed commit.
- Reviews run on a durable job queue stored in the database. You can keep reading the diff while they work. If the server restarts mid-review, the job is picked up again and retried, up to 3 attempts. Errors that retrying won't fix, such as a bad API key or an exhausted budget, fail straight away.
- **Incremental reviews:** when an earlier AI review of the PR exists at an older commit, the run dialog offers to review only the files whose content changed since then. Findings on unchanged files are carried over with their accepted, dismissed or posted state, so nothing is posted twice.

### AI provider types

| Type | Use it for | Notes |
|---|---|---|
| OpenAI-compatible | Ollama, LM Studio, vLLM, OpenAI, AI Foundry v1, OpenRouter, Groq, … | Base URL is the API root, usually ending in `/v1` |
| Anthropic | Claude through the native Messages API | Base URL `https://api.anthropic.com` (or a gateway). Temperature isn't sent, because current Claude models choose their own sampling. |
| Google Gemini | Gemini through the native `generateContent` API | Base URL `https://generativelanguage.googleapis.com/v1beta` with an AI Studio key. JSON mode uses `responseMimeType`. |
| Azure OpenAI | Azure OpenAI deployments API | Base URL is the resource endpoint (`https://NAME.openai.azure.com`), *Deployment name* goes in the model field, and *API version* sets `api-version`. Uses the `api-key` header. |

### Choosing a model

| Situation | Suggestion |
|---|---|
| Code must not leave the network | A local coder model through Ollama or vLLM. Mark the provider **local**. |
| Best quality | A frontier cloud model with a large context window |
| Local GPU with 16–24 GB | `qwen2.5-coder:14b` or similar. Set `AI_CONCURRENCY=1`. |

Set **Context window** on the provider to what the server really supports. For Ollama, also set `OLLAMA_CONTEXT_LENGTH`. If a server rejects `response_format`, turn off **JSON mode**; the prompt still asks for JSON, and the parser tolerates code fences and extra prose.

## Review profiles

A profile saves the settings you use for a kind of review: the model, the review instructions, extra files to skip, whether to send full files for context, and a minimum severity. Create profiles under **Settings → Review profiles**, or click **Save as profile…** in the run dialog. Choosing a profile in the run dialog fills in its settings, and you can still change them for that run.

Profiles are private to you unless you tick **Share with everyone on this server**. A shared profile can be used by everyone, but only its owner or an admin can change or delete it.

## Repository rules (`.pr-review.yml`)

Put a `.pr-review.yml` file at the root of a repository to give every reviewer the same rules. `.pr-review.yaml` and `.github/pr-review.yml` also work.

```yaml
# Instructions added to every review of this repository
instructions: |
  We use Result<T> instead of exceptions.
  All database access goes through the repository classes in src/data.

# Extra files to skip, added to the built-in list and the reviewer's own globs
ignore:
  - "**/*.generated.ts"
  - "docs/**"

# Drop findings below this severity: critical, major, minor or nit
min_severity: minor

# Set to false to never send full files for context (saves tokens on large files)
full_file_context: true

# Instructions for specific paths, sent only with batches that contain matching files
path_instructions:
  - path: "src/api/**"
    instructions: Every handler must check authorization before touching data.
  - path: ["**/*.sql", "migrations/**"]
    instructions: Migrations must be reversible and must not lock large tables.
```

How the rules apply:

- The file is read from the PR's **base commit**, not from the PR itself, so a pull request can't change the rules it is reviewed under.
- The run dialog shows what it found. Untick **Apply repository rules** to skip them for one run.
- The repository's instructions and the reviewer's instructions are both sent. `ignore` patterns are combined. For `min_severity`, the stricter of the repository's and the reviewer's thresholds wins. `full_file_context: false` turns off full-file context even if the reviewer turned it on.
- Unknown keys and invalid values are skipped with a warning, and the rest of the file still applies. The Overview tab shows the rules a review used, along with any warnings.

## Automatic reviews (webhooks)

Under **Settings → Automatic reviews → Add repository**, pick a connection, a repository, and optionally a review profile and model. Then choose what triggers a review: new PRs, new commits, or both. You can also skip drafts and review only changed files. The app gives you a webhook URL and a secret. **Webhook setup** shows the steps for each host:

- **GitHub:** add a repository webhook with content type `application/json` and the secret, subscribed to **Pull requests** events. Requests are verified with `X-Hub-Signature-256`.
- **Azure DevOps:** create two *Web Hooks* service hook subscriptions, one for **Pull request created** and one for **Pull request updated** (filtered to *Source branch updated*). Use basic authentication with the secret as the password.

Each head commit is reviewed once, even when the host redelivers or sends several events. Automatic reviews are **drafts**: they appear under **Automatic draft reviews** in the Inbox and in the PR's review history, and nothing is posted until you submit. They run with the rule owner's connection, and count toward that user's budget.

The code host must be able to reach the app. Set `PUBLIC_URL` to the address it should call, such as `https://pr-review.example.com`. Otherwise the URL is taken from how you opened the settings page.

## Ask about a PR

The **Ask** tab (key `4`) opens a chat about the pull request. Each question is answered from the PR description, the changed files and their diffs, and the latest review's findings. It can also include the full content of the file you have open. When the diff doesn't fit the model's context window, the file you're viewing and the files your question names are included first, and the answer says what was left out. Conversations are private to you and stored per PR. Secrets are masked for cloud providers, as with reviews.

## Costs and budgets

Give each AI provider an input and output price (USD per million tokens) to track cost. Local models can stay unpriced. Every model call is recorded: reviews, chat and connection tests. **Settings → Usage and budgets** shows month-to-date spend (UTC calendar month) for you and for each provider. Admins also see spend per user.

- **Provider budget:** a monthly cap across all users, set on the provider.
- **Per-user limit:** a monthly cap for each user, set by an admin in *Usage and budgets*.

Before a review starts, its cost is estimated from the batches it will send, and it's refused if that would exceed a budget. Each model call is also checked, so a long review or chat stops once the cap is reached. A blocked request returns HTTP 402 with the amounts involved.

## Users, roles and single sign-on

The first account is the admin. Admins manage everyone under **Settings → Administration**.

| Role | Can |
|---|---|
| Admin | Everything: users and roles, SSO, code host apps, AI providers, budgets |
| Lead | Everything a reviewer can, plus the team dashboard, the audit log, and sharing or editing shared profiles |
| Reviewer | Run AI reviews, chat about PRs, post reviews, set up automatic reviews (default for new users) |
| Viewer | Read-only: browse PRs and read reviews. Can't run AI or post. |

Every API route checks the caller's role, and the UI hides what the role can't use. There must always be at least one active admin. Deactivating a user signs them out everywhere.

**Single sign-on.** Under **Single sign-on → Add sign-in provider**:

| Provider | What to enter |
|---|---|
| Microsoft Entra ID | Tenant ID or primary domain, application (client) ID, client secret |
| Google | OAuth client ID and secret |
| OpenID Connect | Issuer URL (discovery is read from `/.well-known/openid-configuration`), client ID and secret |
| GitHub | OAuth app client ID and secret; the Enterprise Server URL if you don't use github.com |

After saving, register the redirect URI it shows (`…/api/auth/sso/<id>/callback`) with the provider.

- Sign-in uses the authorization code flow with PKCE, plus `state` and a nonce. The ID token's issuer, audience, expiry and nonce are all checked.
- **Allowed email domains** restrict who can sign in. Accounts are matched by **verified** email and linked the first time someone signs in. **Create an account the first time someone signs in** adds new users with the role you choose.
- Turning off **Allow email and password sign-in for everyone** leaves password sign-in to admins only, so you can't lock yourself out. The login page then shows SSO buttons, with a small *Admin sign-in with password* link.
- Set `PUBLIC_URL` so redirect URIs match the address people use, and `COOKIE_SECURE=true` behind HTTPS.

## Code host apps (GitHub App and Microsoft sign-in)

Admins register apps under **Settings → Administration → Code host apps**. People then choose **Add connection → Connect with an app**.

**GitHub App.** Create a GitHub App with **Pull requests: Read & write**, **Contents: Read** and **Metadata: Read**. Set both its *Callback URL* and *Setup URL* to the callback URL shown in the app list, and tick *Request user authorization (OAuth) during installation*. Then enter the App ID, URL name (slug), client ID and secret, and a private key.
- Tokens are short-lived installation tokens (1 hour), minted with the app's private key. No personal token is stored.
- Reviews are posted by the app's bot account.
- When someone connects, the app checks with their own GitHub authorization which installations they can access, and adds a connection for each. Only repositories the app is installed on are listed. The inbox shows PRs where that person's review is requested.

**Azure DevOps with Microsoft sign-in.** Register an app in Entra ID with a *Web* redirect URI (the callback shown in the list) and the delegated **Azure DevOps → user_impersonation** permission. Enter the tenant, client ID and secret.
- Each person signs in with Microsoft and enters their organization URL. They get a connection with their own Azure DevOps access.
- The refresh token is stored encrypted and rotated on every refresh. Access tokens live in memory only.

## Team dashboard and audit log

**Dashboard** (leads and admins) covers the last 7, 30 or 90 days:
- AI reviews, split into automatic and incremental
- reviews posted to the PR
- the acceptance rate of AI findings (accepted or posted, out of all findings someone decided on)
- the median time from a finished review to posting it
- AI spend, reviews per day, and findings by severity
- tables per repository and per reviewer

Findings carried over by incremental reviews are counted once.

**Audit log** (leads and admins) lists sign-ins (including failed SSO attempts), user and role changes, SSO and app changes, connections, providers, profiles, automatic review rules, budgets, and started and posted reviews. You can filter by action or action group and search the details or email.

## The review workspace

- File tree with change stats, a marker for the most severe finding, a filter, "with findings", "hide viewed", and viewed tracking. A file becomes unviewed again when it changes.
- **Unified**, **Split** and **Full file** views, with syntax highlighting.
- Inline finding cards: **Accept**, **Edit** (severity, category, text, suggested code), **Dismiss** and **Restore**.
- Click **+** on any line to comment, and Shift+click another line to select a range. You can add a code suggestion, which is posted as a GitHub `suggestion` block.
- **Overview** tab: AI summary, risk level, severity counts, token usage, skipped files and the PR description.
- **Findings** tab: filter by severity and state, and click a finding to jump to it.
- Review history for each PR, and a dark/light theme.

| Key | Action |
|---|---|
| `j` / `k` | Next / previous finding |
| `n` / `p` | Next / previous file |
| `a` / `d` / `u` / `e` | Accept / dismiss / reset / edit the focused finding |
| `v` | Toggle the current file as viewed |
| `1` `2` `3` `4` | Overview / Files / Findings / Ask |
| `?` | Show shortcuts |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MASTER_KEY` | **required in production** | Encryption key for stored credentials |
| `DATABASE_URL` | unset → embedded PGlite | Postgres connection string |
| `DATA_DIR` | `/data` | Location of the embedded database |
| `ALLOW_REGISTRATION` | `false` | Allow sign-ups after the first admin |
| `COOKIE_SECURE` | `false` | Set to `true` behind HTTPS |
| `AI_TIMEOUT_MS` | `300000` | Timeout for each model request |
| `AI_CONCURRENCY` | `2` | Parallel model requests per review |
| `JOB_CONCURRENCY` | `2` | Reviews each server process runs at once |
| `JOB_WORKER` | on | Set to `off` to stop this process from running background jobs |
| `JOB_STALE_AFTER_MS` | `120000` | How long a job can go without a heartbeat before it's retried |
| `PUBLIC_URL` | – | Base URL for webhooks, SSO redirect URIs and code host app callbacks |
| `HTTPS_PROXY`, `NO_PROXY` | – | Outbound proxy (the image sets `NODE_USE_ENV_PROXY=1`) |
| `NODE_EXTRA_CA_CERTS` | – | Path to a corporate root CA bundle mounted into the container |

The database migrates itself on startup. `GET /api/healthz` is used by the container health check.

## Security notes

- Tokens and API keys are encrypted with AES-256-GCM and are never returned by the API.
- Passwords are hashed with bcrypt. Login is throttled per email address.
- Sessions use random tokens stored as SHA-256 hashes, in an HttpOnly, SameSite=Lax cookie.
- Mutating API calls require an `X-Requested-With` header as CSRF protection.
- Before code is sent to non-local providers, the app masks common secrets: private keys, AWS, GitHub, OpenAI/Anthropic, Slack and Google keys, JWTs, connection-string passwords and `password=` literals. This is best-effort. Use a local model for sensitive repositories.
- An audit log records sign-ins, user, role, SSO and app changes, connection and provider changes, and started and posted reviews. Leads and admins can browse it under **Audit log**.
- Roles are enforced on every API route. Viewers can't run AI or post reviews.
- SSO uses the authorization code flow with PKCE, state and a nonce. ID-token claims are validated, and accounts are linked only by verified email.
- GitHub App connections use 1-hour installation tokens. Entra refresh tokens are encrypted and rotated. OAuth state cookies are encrypted, short-lived and scoped to their callback path.
- Posted reviews carry a footer saying they were AI-assisted and verified by you. You can turn it off for each review.
- Repository rules are read from the target branch, never from the PR being reviewed.

## Development

```bash
npm install
npm run dev          # http://localhost:3000, embedded DB in ./data
npm test             # unit tests for diffs, parsing, chunking, redaction, filters and repository rules
npm run lint         # type check
npm run db:generate  # after editing src/server/db/schema.ts
```

```
src/
  app/                    Next.js pages and /api route handlers
  components/review/      workspace, diff view, file tree, finding cards, dialogs
  lib/diff.ts             unified-diff parser shared by the client and server
  lib/unified-diff.ts     line diff that builds unified hunks (for Azure DevOps)
  server/
    scm/                  ScmProvider interface, GitHub and Azure DevOps adapters
    ai/                   AiClient interface; OpenAI-compatible (+ Azure OpenAI), Anthropic and Gemini adapters
    profiles/             saved review profiles
    review/               rules → filter → chunk → prompts → parse → engine → post; incremental carry-forward
    jobs/                 durable job queue (FOR UPDATE SKIP LOCKED) and the in-process worker
    webhooks/             GitHub / Azure DevOps event parsing, signature checks, automatic reviews
    chat/                 "Ask about this PR" context building
    usage.ts              usage ledger, cost and budget checks
    auth/                 sessions, SSO (OIDC / GitHub OAuth), ID-token checks, auth settings
    dashboard/            team metrics aggregation
  lib/permissions.ts      role → permission map shared by the API and the UI
    db/                   Drizzle schema and client (Postgres or PGlite)
drizzle/                  SQL migrations
```

**Adding a code host:** implement `ScmProvider` in `src/server/scm/types.ts` and register it in `src/server/scm/index.ts`.
**Adding an AI SDK:** implement `AiClient` in `src/server/ai/types.ts` and register it in `src/server/ai/index.ts`.

## Roadmap

| Phase | Scope |
|---|---|
| 1 ✓ | Docker image, local accounts, multiple GitHub/GHES connections, any OpenAI-compatible model, diff workspace, AI review, accept/edit/dismiss, manual comments and suggestions, posting reviews, secret masking, audit log |
| 2 ✓ | Azure DevOps (PAT; threads and reviewer votes), native Anthropic, Azure OpenAI and Gemini adapters, saved review profiles, repo rules file (`.pr-review.yml`) |
| 3 ✓ | Durable job queue and webhooks for automatic draft reviews, incremental review of new commits only, "ask about this PR" chat, cost budgets |
| **4 ✓ (this release)** | OIDC SSO (Entra ID / GitHub / Google), roles, audit log UI, team dashboard, GitHub App and Entra OAuth |
