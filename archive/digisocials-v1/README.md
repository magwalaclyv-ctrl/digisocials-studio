# DigiSocials

DigiSocials is an original social-publishing workspace: write drafts, connect supported social accounts, queue posts, review your calendar and see verified publishing activity. It is inspired by the social-management product category, not a copy of another service.

## What works in this launch version

- Supabase email/password sign-up and sign-in, with one private workspace per user.
- Owner-checked API routes, database row-level security, encrypted provider tokens in a server-only table, and server-only service-role access.
- Draft creation and a calendar/content library backed by Supabase.
- Secure account disconnect controls; queued posts targeting a disconnected channel fail visibly rather than silently.
- Scheduled publishing worker for connected Facebook Pages, Instagram professional accounts and LinkedIn personal profiles. Publishing attempts happen at the scheduled time; provider errors and partial outcomes are shown rather than reported as successful.
- A public HTTPS image URL can be attached to a post. Instagram publishing requires an image and a professional account; LinkedIn publishing is text-only in this release.
- Analytics from real DigiSocials post states and published counts. Engagement columns and screens are ready for real provider snapshots; automatic engagement-insights ingestion is **not** included, so likes, comments and impressions remain blank until a separately approved provider insights integration is added.
- Responsive sign-in, first-run setup guidance, account connections, overview, calendar, content library and analytics screens.

This is not an unlimited copy of Ocoya. There is no AI copy/image generation, media upload/storage, team collaboration, X/TikTok/YouTube publisher, or automatic platform-insights importer in this launch version. No external services are provisioned or deployed on your behalf.

## Run locally

Requirements: Node.js 22.12+ and npm.

1. Create a Supabase project in your own account. In **Project Settings → API**, copy the Project URL, anon/publishable key and service-role key.
2. In Supabase **SQL Editor**, run [`supabase/migrations/202610170001_initial_schema.sql`](supabase/migrations/202610170001_initial_schema.sql).
3. Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Generate a token-encryption key with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Put that output in `TOKEN_ENCRYPTION_KEY`. **Keep both server-only keys private**; never prefix either with `VITE_`.
4. Set Supabase **Authentication → URL Configuration → Site URL** to `http://localhost:5173` and add `http://localhost:5173/**` to the allowed redirect URLs. Configure email confirmation or disable it for a private development project.
5. Install packages and start the app:

   ```powershell
   npm ci
   npm run dev
   ```

   Open `http://localhost:5173`. The API runs on port 3001; Vite proxies `/api` requests to it. The first sign-up creates the workspace. Without Supabase keys the sign-in page explains which settings are missing.
6. Run the checks with `npm test`, `npm run lint` and `npm run build`.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Yes | Public client key used only for Supabase Auth in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only key for API database work and auth-token verification. Never publish it. |
| `TOKEN_ENCRYPTION_KEY` | For social connections | Base64-encoded 32-byte AES-256 key. Losing it requires reconnecting provider accounts. |
| `PUBLIC_APP_URL` | For OAuth / production | Exact public origin, e.g. `http://localhost:5173` locally or `https://your-app.fly.dev` in production. |
| `PORT` | Optional | HTTP port; Fly uses 8080. |
| `META_APP_ID`, `META_APP_SECRET` | Optional | Meta OAuth for Facebook Pages and linked Instagram professional accounts. |
| `META_GRAPH_VERSION` | Optional | Graph API version; default `v23.0`. |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Optional | LinkedIn OAuth and text publishing. |

## Configure real social publishing

Third-party connections require your own provider applications, platform permissions, public callback URL, and sometimes review. A visible **Connect** button is enabled only when the server has the required app credentials and encryption key. The API uses official OAuth and platform endpoints; it does not simulate a successful link or publish.

### Meta (Facebook Pages and Instagram)

1. Create/configure a Meta developer app and add the Facebook Login product. Add this exact **Valid OAuth Redirect URI**: `{PUBLIC_APP_URL}/api/oauth/callback`.
2. Set `META_APP_ID` and `META_APP_SECRET`.
3. Request/enable `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. Meta may require the app to be live, permission review, business verification, and test users/roles.
4. The authorizing user must manage a Facebook Page; an Instagram professional account must be linked to that Page for it to appear. Publishing a Page feed post supports text and an optional link. Instagram posts need a publicly reachable HTTPS image URL. Platform media/account restrictions still apply.

### LinkedIn

1. Create a LinkedIn developer app and enable Sign In with LinkedIn using OpenID Connect plus the Community Management API product/access needed for member posting.
2. Add `{PUBLIC_APP_URL}/api/oauth/callback` as the OAuth 2.0 redirect URL. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
3. The app requests `openid profile w_member_social`. LinkedIn may need to approve the product and scopes for your application. Publishing targets the authorized personal member profile; organization pages are not supported here.

Changing a provider secret or redirect URL requires restarting/redeploying the app. Provider-specific permissions and token lifetimes are controlled by those platforms, not DigiSocials.

## Deploy to Fly.io

Deploying requires your Fly.io account, Supabase project, and (if desired) Meta/LinkedIn app credentials. The repository contains a Dockerfile and a Fly health check; no external deploy is run by this project setup.

1. Install the Fly CLI, sign in using `fly auth login`, then from this directory run `fly launch --no-deploy`. Choose a unique Fly app name and region, or replace the placeholder `app = "digisocials-change-me"` in `fly.toml` with an unused name.
2. Create a separate base64 encryption key with the PowerShell command above. Set required Fly secrets (substitute your values):

   ```powershell
   fly secrets set SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" SUPABASE_ANON_KEY="YOUR_PUBLIC_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVER_ONLY_SERVICE_ROLE_KEY" TOKEN_ENCRYPTION_KEY="YOUR_BASE64_32_BYTE_KEY" PUBLIC_APP_URL="https://YOUR_APP_NAME.fly.dev"
   ```

3. Configure Supabase Auth Site URL and allowed redirect URLs for `https://YOUR_APP_NAME.fly.dev`.
4. If using Meta or LinkedIn, add `https://YOUR_APP_NAME.fly.dev/api/oauth/callback` in each provider app and set its server secrets:

   ```powershell
   fly secrets set META_APP_ID="..." META_APP_SECRET="..."
   fly secrets set LINKEDIN_CLIENT_ID="..." LINKEDIN_CLIENT_SECRET="..."
   ```

   Only set the provider secrets you need. `META_GRAPH_VERSION` is optional.
5. Apply the migration to your Supabase project using its SQL Editor (or your approved Supabase CLI workflow), then deploy and check logs:

   ```powershell
   fly deploy
   fly logs
   ```

The Fly configuration keeps one machine running because the scheduling worker runs in the app process. Do not scale multiple workers independently; the atomic database claim protects a post from being claimed twice, but provider timeouts during an external publish can still require manual review. Monitor `/api/health` and provider permissions after deployment.

## Security and operational notes

- The service-role key and provider secrets exist only on the server. Authentication tokens are verified against Supabase Auth on protected routes; workspace ownership and selected social-account membership are checked on writes.
- OAuth state and encrypted social tokens are stored in tables with client-role access explicitly revoked; the browser receives only account metadata.
- Provider tokens are AES-256-GCM encrypted before storage. Back up `TOKEN_ENCRYPTION_KEY` securely: a rotated/lost key cannot decrypt existing tokens.
- Database RLS is enabled for owner-visible workspaces/posts/accounts/analytics. OAuth state rows have no user-facing policy and are used only via the server service role.
- Scheduled publish operations can fail or partially succeed due to provider access, post format, expired permissions or network errors. Failures and per-account outcomes remain visible in the Content library.
- Provider callbacks and scheduled publishing were not tested against live Meta/LinkedIn apps. Live OAuth, real publishing, email delivery and hosted migrations require the user's credentials and platform approvals.
