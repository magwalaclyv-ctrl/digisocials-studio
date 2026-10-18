# DigiSocials

DigiSocials combines the supplied DigiTech Group identity with BrightBean
Studio's open-source social-media publishing platform. The active application
is Django/HTMX with a background publishing worker; the original DigiSocials
React/Express/Supabase implementation is retained in
[`archive/digisocials-v1/`](archive/digisocials-v1/) for reference.

## What is included

- Email sign-up/login, organizations, multiple workspaces, team roles and
  client approvals.
- A post composer, drafts and ideas, media library, content calendar,
  scheduling queues and publishing history.
- A gallery for local media uploads, optional AI-assisted idea prompts, and a
  Studio editor for reusable post, story, reel and ad layouts with common
  network-size presets.
- Direct publishing integrations for Facebook, Instagram, LinkedIn, TikTok,
  YouTube, Pinterest, Threads, Bluesky, Google Business Profile, Mastodon and
  DEV.to, plus platform-dependent inbox and analytics integrations.
- A separate publishing worker with retries and visible per-platform outcomes.
- Supabase Postgres support through Django's PostgreSQL connection and
  Supabase Storage's S3-compatible API for persistent media.
- Fly.io configuration for a web process, a background worker and automatic
  database migrations.

Publishing, inbox, and provider analytics use the platforms' official APIs.
They require your own developer credentials, user authorization, and in some
cases platform review. The app does not simulate successful publishing or
analytics. Post-idea brainstorming can use an optional OpenAI-compatible API;
without credentials, the Create page clearly labels its local prompt starters.
AI/billing intelligence is a separate optional service and is disabled until
its integration is configured.

## Run locally

Requirements: Python 3.12+ and Node.js 20+.

1. Create a virtual environment, install Python packages and prepare local
   settings:

   ```powershell
   py -3.12 -m venv .venv
   .venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   Copy-Item .env.example .env
   ```

   The example uses SQLite for local development. Replace the example
   `SECRET_KEY` and `ENCRYPTION_KEY_SALT` with unique random values before
   sharing the app or storing connected-account credentials.

2. Build the Tailwind stylesheet and apply the Django migrations:

   ```powershell
   Push-Location theme\static_src
   npm ci
   npm run build
   Pop-Location
   python manage.py migrate
   ```

3. In one terminal, start Django:

   ```powershell
   python manage.py runserver 8000
   ```

   In another terminal, start the publishing/background worker:

   ```powershell
   .venv\Scripts\Activate.ps1
   python manage.py run_studio_worker
   ```

   Open <http://localhost:8000>. Create an account using the built-in sign-up
   page. Keep the worker running to process scheduled posts and background
   jobs. The development settings send email to the console.

4. Run the automated tests with a PostgreSQL test database available at
   `DB_HOST`/`DB_PORT` (default `localhost:5432`) and the credentials in
   `DB_USER`/`DB_PASSWORD`:

   ```powershell
   pytest
   ```

   The test settings use PostgreSQL because parts of the app depend on
   PostgreSQL behavior. Production Supabase migrations are managed by Django;
   do not execute the archived React app's SQL migration against this schema.

## Supabase setup

DigiSocials uses Supabase **Postgres** as its application database; user
authentication is handled by Django, not Supabase Auth. The previous
Supabase-auth implementation is preserved only in the archive.

1. Create a Supabase project and copy its **session pooler** connection URI
   from the project's database connection settings. Use the session pooler
   (typically port `5432`), not transaction mode, for Django and the worker.
   URL-encode special characters in the database password and require TLS
   (`sslmode=require`).
2. Set `DATABASE_URL` to that URI. The first deployment runs all Django
   migrations as a Fly release command; no manual SQL migration is needed.
3. Create a Supabase Storage bucket for uploads. To keep uploaded media
   persistent across Fly machines and redeploys, configure the S3-compatible
   storage endpoint and access keys in `S3_ENDPOINT_URL`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_BUCKET_NAME`. The
   endpoint format is `https://<project-ref>.supabase.co/storage/v1/s3`;
   use the storage S3 credentials (not the database password or a browser
   publishable key) and set `S3_REGION_NAME=us-east-1`.
4. For local SQLite development, leave `STORAGE_BACKEND=local`. Fly is set to
   `STORAGE_BACKEND=s3` because its filesystem is ephemeral.

## Fly.io deployment

Deploying requires your own Fly.io app, Supabase project, public source
repository, storage credentials, and any social-platform credentials. Nothing
is deployed or provisioned on your behalf.

1. Install `flyctl` and sign in. Replace `app = "digisocials-change-me"` in
   `fly.toml` with an unused app name, then create the app without deploying:

   ```powershell
   fly auth login
   fly launch --no-deploy
   ```

   Keep the `app`, `worker`, and `release_command` configuration in
   `fly.toml`.

2. Set the required secrets. Use the Supabase session-pooler URI and S3
   credentials from your own project. Publish the exact source corresponding
   to the deployment and set `SOURCE_CODE_URL`; the app exposes this link
   because the combined project is distributed under AGPL-3.0.

   ```powershell
   fly secrets set SECRET_KEY="..." ENCRYPTION_KEY_SALT="..." `
     DATABASE_URL="..." APP_URL="https://YOUR_APP.fly.dev" `
     ALLOWED_HOSTS="YOUR_APP.fly.dev" SOURCE_CODE_URL="https://github.com/YOU/YOUR_REPO" `
     S3_ENDPOINT_URL="https://YOUR_PROJECT.supabase.co/storage/v1/s3" `
     S3_ACCESS_KEY_ID="..." S3_SECRET_ACCESS_KEY="..." S3_BUCKET_NAME="YOUR_BUCKET" `
     S3_REGION_NAME="us-east-1"
   ```

   Generate separate random values for Django's `SECRET_KEY` and
   `ENCRYPTION_KEY_SALT`; back them up securely. Losing the encryption salt
   makes existing provider credentials unreadable. Set `TERMS_URL`,
   `PRIVACY_URL`, and `SUPPORT_EMAIL` to your own public policies and support
   contact before accepting public users.

3. Deploy and make sure both process groups are running:

   ```powershell
   fly deploy
   fly scale count app=1 worker=1
   fly status
   fly logs
   ```

   The release command applies schema migrations. The `/health/` endpoint is
   used for the web health check. Keep one worker running so scheduled posts
   and queued tasks are processed.

## Social-provider configuration

To enable a provider, create its developer application, configure its
redirect/webhook URLs as shown in the connection flow and set the matching
`PLATFORM_*` credentials from `.env.example` locally or as Fly secrets. The
user connecting an account must grant the requested permissions. Provider
review, business verification, API quotas and publishing restrictions are
controlled by each platform. SMTP settings are also needed for production
invites and password-reset email. Without the relevant credentials, those
external integrations remain unavailable and the app reports their status
instead of claiming success.

## Configuration reference

`.env.example` lists the supported environment variables. The main deployment
values are:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY` | Django signing/session secret. Keep private and stable. |
| `ENCRYPTION_KEY_SALT` | Salt for encrypted platform credentials; preserve backups. |
| `DATABASE_URL` | Local SQLite URL or Supabase PostgreSQL session-pooler URI. |
| `APP_URL`, `ALLOWED_HOSTS` | Public HTTPS origin and allowed hostnames. |
| `STORAGE_BACKEND` | `local` for development, `s3` for persistent Fly media. |
| `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` | Supabase Storage S3-compatible connection. |
| `SOURCE_CODE_URL` | Public URL for the corresponding source of this AGPL network service. |
| `TERMS_URL`, `PRIVACY_URL`, `SUPPORT_EMAIL` | Operator-owned legal and support information. |
| `POST_IDEAS_API_KEY`, `POST_IDEAS_API_URL`, `POST_IDEAS_MODEL` | Optional OpenAI-compatible provider for Create-page idea generation. |

## License and provenance

This combined work includes modified BrightBean Studio code under
AGPL-3.0-or-later. Preserve the notices in [`LICENSE`](LICENSE), and provide
the corresponding source when operating a modified version over a network.
See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for details.
