# Running Acquisitions with Docker + Neon

This app connects to Postgres through [Neon](https://neon.tech). Locally, it talks to **Neon Local**, a Docker proxy that spins up a real, ephemeral Neon branch for you. In production, it talks straight to your **Neon Cloud** database. Nothing about the application code changes between the two, only which `DATABASE_URL` and Docker Compose file you use.

## How the two environments differ

|                   | Development                                                                                          | Production                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Compose file      | `docker-compose.dev.yml`                                                                             | `docker-compose.prod.yml`                                                                |
| Dockerfile target | `development` (hot reload via `node --watch`)                                                        | `production` (minimal image, non-root user)                                              |
| Database          | Neon Local proxy container, creates/destroys an ephemeral branch each run                            | Your real Neon Cloud database, connected directly                                        |
| `DATABASE_URL`    | Fixed local value, hardcoded in `docker-compose.dev.yml` (`postgres://neon:npg@neon-local:5432/...`) | Your actual Neon connection string, supplied via `.env.production` / your secret manager |
| Env file          | `.env.development`                                                                                   | `.env.production`                                                                        |

---

## 1. Development: running locally with Neon Local

### Prerequisites

- Docker and Docker Compose installed
- A Neon account and project ([console.neon.tech](https://console.neon.tech))
- Your Neon **API key** (Account Settings → API Keys) and **Project ID** (Project Settings → General)

### Setup

1. Copy the template and fill in your Neon credentials:

   ```bash
   cp .env.development .env.development.local   # optional, if you prefer not to edit the tracked template
   ```

   Open `.env.development` (or your local copy) and fill in:

   ```
   NEON_API_KEY=your_api_key_here
   NEON_PROJECT_ID=your_project_id_here
   PARENT_BRANCH_ID=your_staging_branch_id_here
   ARCJET_KEY=your_arcjet_key_here
   ```

   You don't need to set `DATABASE_URL` here, `docker-compose.dev.yml` points it at the Neon Local container automatically.

   Also create `.env` with `DATABASE_URL` set to your **staging** branch's connection string. It is only used on your host, to run migrations in step 2.

2. Start everything:

   ```bash
   npm run dev:docker
   ```

   This runs `scripts/dev-setup.sh`. It first applies migrations **on your host** with `npm run db:migrate`, against the staging branch in `.env`, and then runs `docker compose -f docker-compose.dev.yml up --build`, which starts two containers:
   - **`neon-local`** — connects to your Neon project using the API key, creates a brand-new ephemeral branch off `PARENT_BRANCH_ID` (staging, so it already has the schema that was just migrated), and exposes a Postgres endpoint on `localhost:5432`.
   - **`app`** — your Express app, built from the Dockerfile's `development` stage, running `npm run dev` (`node --watch`) so code changes under `src/` reload automatically. Your local `src/` folder is bind-mounted in, so you edit on your host and the container picks it up.

3. The app is now at **http://localhost:3000**. The database is a fresh, isolated Neon branch, nothing you do to it touches your real data.

4. To change the schema, generate a migration on your host and restart:

   ```bash
   npm run db:generate
   npm run dev:docker
   ```

   `dev-setup.sh` migrates staging first and Neon Local then branches from it, so the new dev branch includes the change. Migrations are not run inside the container, and they never target the short-lived dev branch.

### Stopping

```bash
docker compose -f docker-compose.dev.yml down
```

Because `DELETE_BRANCH` defaults to `true`, the ephemeral Neon branch created for this session is deleted automatically when `neon-local` stops. Next time you run `up`, you get a clean branch again. If you want to keep a branch around between runs (e.g. to debug something), uncomment `DELETE_BRANCH: "false"` in `docker-compose.dev.yml`.

### Why the database client has a dev-only branch

`src/config/database.js` checks `NODE_ENV`. In development, it points the Neon serverless driver at the Neon Local proxy (`neonConfig.fetchEndpoint` and related settings), because the proxy only speaks HTTP. In production none of that runs, and the driver connects to Neon Cloud exactly as it would by default.

Migrations don't need any of this. `drizzle-kit` reads the root `drizzle.config.js`, which loads `.env` with `dotenv/config` and passes `DATABASE_URL` straight through. It has no `NODE_ENV` checks and no Neon Local settings, because migrations always run on your host against a Neon Cloud branch: staging in development, production in `prod-setup.sh`. A `DATABASE_URL` already set in the environment takes precedence over `.env`, which is how `prod-setup.sh` points it at production.

---

## 2. Production: deploying with Neon Cloud

### Setup

1. Fill in `.env.production` with your real values, or better, inject these as environment variables through your deployment platform (CI/CD secrets, Kubernetes secrets, your host's dashboard) rather than keeping a filled-in file on disk:

   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://<user>:<password>@<endpoint>.aws.neon.tech/<dbname>?sslmode=require&channel_binding=require
   ARCJET_KEY=your_arcjet_key_here
   JWT_SECRET=a_long_random_secret_here
   ```

   Get the connection string from your Neon project's **Connect** dialog in the console. This should be your actual production branch, not a Neon Local proxy, there is no proxy involved at all in this file.

   `JWT_SECRET` is required: with `NODE_ENV=production`, the app refuses to start without it.

2. Migrate and start:

   ```bash
   npm run prod:docker
   ```

   This runs `scripts/prod-setup.sh`, which:
   1. Checks that `.env.production` exists and that Docker is running.
   2. Reads `DATABASE_URL` from `.env.production` and runs `npm run db:migrate` on your host against the **production** database, before the new code starts. If the migration fails, the script stops and the app is not started.
   3. Builds and starts the container with `docker compose -f docker-compose.prod.yml up --build -d`. This uses the Dockerfile's `production` target: a minimal image with only production dependencies, running as a non-root user, with a `/health` healthcheck wired in.
   4. Waits 5 seconds and checks that the `acquisitions-app-prod` container is still running. If it isn't, for example because `JWT_SECRET` is missing, it prints the last 20 log lines and exits with an error.

### Stopping

```bash
docker compose -f docker-compose.prod.yml down
```

This only stops your app container. Your Neon Cloud database is unaffected, since it isn't something this Compose file manages, it already existed before and keeps existing after.

---

## 3. How `DATABASE_URL` actually switches

Nothing in the application code hardcodes which database to use, it always just reads `process.env.DATABASE_URL`. What changes is **where that value comes from**:

- **Dev:** `docker-compose.dev.yml` sets `DATABASE_URL` directly in its `environment:` block, pointing at the `neon-local` service by its Compose service name. This value is fixed and not secret, Neon Local accepts that `neon:npg` login for any local session.
- **Prod:** `docker-compose.prod.yml` does **not** set `DATABASE_URL` itself, it's pulled in via `env_file: .env.production`, which should be populated from your actual Neon Cloud credentials (ideally injected by a secret manager rather than a plaintext file sitting in your deploy environment).

This is also why `.env.development` and `.env.production` are both gitignored, even though the dev one has little that's truly secret, it's good habit to keep all env files out of version control uniformly.

---

## 4. File reference

| File                      | Purpose                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Dockerfile`              | Multi-stage build: `development` (hot reload, full deps) and `production` (minimal, non-root, healthcheck) targets |
| `docker-compose.dev.yml`  | Runs `app` (dev target) + `neon-local` proxy, creates ephemeral branches                                           |
| `docker-compose.prod.yml` | Runs `app` (production target) only, connects straight to Neon Cloud                                               |
| `.env.development`        | Dev env vars: Neon Local/API credentials, no `DATABASE_URL` (set in compose instead)                               |
| `.env.production`         | Prod env vars: real `DATABASE_URL`, template only, never commit filled-in                                          |
| `.dockerignore`           | Keeps `node_modules`, `.git`, `.env*`, logs, etc. out of the build context                                         |

---

## Notes / things to double-check

- **Rotate any credentials that were ever committed or shared in plaintext.** If your `.env` has ever had real values in a shared archive, repo, or chat, treat them as compromised and regenerate them in the Neon and Arcjet consoles.
- **Neon Local image/version**: this setup uses `neondatabase/neon_local:latest`. For anything beyond local dev, pin to a specific tag instead of `latest` so builds are reproducible.
- **bcrypt native bindings**: the Dockerfile installs `libc6-compat` on Alpine so `bcrypt`'s native module builds correctly. If you ever see bcrypt-related install errors, that's the first thing to check.
- Full Neon Local reference: <https://neon.com/docs/local/neon-local>
