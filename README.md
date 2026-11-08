# Acquisitions API

A REST API for an acquisitions marketplace. Users list businesses for sale, other users make offers on them, and sellers accept or reject those offers. Accepting an offer marks the listing as sold and rejects the other open offers in a single transaction.

## DevOps highlights

- **Docker multi-stage build:** one Dockerfile with a `development` target (hot reload) and a `production` target that has only production dependencies, runs as a non-root user and has a `/health` health check.
- **CI/CD pipeline:** every pull request to `main` or `staging` runs ESLint, Prettier and the Jest suite. Merging to `main` builds the production image and publishes it to Docker Hub, tagged `latest`, with the commit SHA and with a timestamp.
- **Neon environments:** a production database, a long-lived staging branch, and short-lived development branches created by Neon Local. Migrations are generated with drizzle-kit, applied to staging during development, and applied to production by `prod-setup.sh` before the new container starts.
- **Secrets kept out of the repo:** env files are git-ignored and `.env.example` holds placeholders only. CI reads Docker Hub credentials from GitHub secrets, and the app refuses to start in production without `JWT_SECRET`.
- **Tests with no external dependencies:** the database and Arcjet are mocked, so the suites run in CI with no database, network access or real credentials.
- **Coming next:** deploying to AWS, with the infrastructure defined in Terraform.

## Tech stack

| Area                  | Tools                                                       |
| --------------------- | ----------------------------------------------------------- |
| Runtime and framework | Node.js (ES modules), Express 5                             |
| Database              | Neon Postgres, Drizzle ORM and drizzle-kit migrations       |
| Validation            | Zod                                                         |
| Auth                  | JWT stored in an httpOnly cookie, bcrypt password hashing   |
| Security              | Arcjet (shield, bot detection, rate limiting), Helmet, CORS |
| Logging               | Winston, Morgan                                             |
| Testing               | Jest, Supertest                                             |
| Delivery              | Docker (multi-stage image), Docker Compose, GitHub Actions  |

## Features

- **Auth and roles.** Sign up, sign in and sign out. The JWT is set as an httpOnly `token` cookie that expires after 15 minutes. Every new account gets the `user` role. A `role` sent at sign-up is ignored, so admins are promoted with `PUT /api/users/:id` by another admin.
- **Users.** Users can view, update and delete their own account. Admins can do this for any account, list all users, and change roles.
- **Listings.** Any signed-in user can create and browse listings. A listing has a title, an optional description, an asking price (`numeric(12,2)`) and a status: `active`, `sold` or `withdrawn`. Only the seller or an admin can update or delete a listing.
- **Deals.** A deal is a buyer's offer on an active listing. A buyer can't make an offer on their own listing, and can have only one pending offer per listing; the database enforces this with a partial unique index. The seller accepts or rejects an offer, and the buyer can withdraw it. Accepting an offer, in one database transaction:
  - marks the deal as accepted,
  - marks the listing as sold,
  - rejects every other pending offer on that listing.

  If another request changes the deal or the listing at the same moment, the whole transaction is rolled back and the API returns `409`. Deals are never deleted; they're kept as history.

- **Rate limiting by role.** Arcjet limits each client to 5 requests per minute as a guest, 10 as a signed-in user and 20 as an admin. On top of that, a base rule in `src/config/arcjet.js` allows every client at most 5 requests per 2 seconds. Over either limit, the API returns `429 Too Many Requests` with a `Retry-After: 60` header. Arcjet also blocks common attacks (shield) and automated clients with `403`, though search-engine crawlers and link-preview bots are allowed.
- **Global error handler.** Errors return JSON and never include stack traces or internal error messages:

  | Cause                      | Status      | Body                                   |
  | -------------------------- | ----------- | -------------------------------------- |
  | Malformed JSON body        | `400`       | `{ "error": "Invalid JSON" }`          |
  | Body over the 100 kB limit | `413`       | `{ "error": "Payload too large" }`     |
  | Any other 4xx client error | that status | `{ "error": "Bad request" }`           |
  | Anything else              | `500`       | `{ "error": "Internal server error" }` |

## API endpoints

All bodies are JSON. "Signed in" means a valid `token` cookie from sign-up or sign-in.

### General

| Method | Path      | Who    | Description                                                   |
| ------ | --------- | ------ | ------------------------------------------------------------- |
| GET    | `/`       | Anyone | Plain-text greeting                                           |
| GET    | `/health` | Anyone | Status, timestamp and uptime, used by the Docker health check |
| GET    | `/api`    | Anyone | Confirms the API is running                                   |

### Auth: `/api/auth`

| Method | Path        | Who    | Description                                                        |
| ------ | ----------- | ------ | ------------------------------------------------------------------ |
| POST   | `/sign-up`  | Anyone | Create an account (`name`, `email`, `password`) and sign in        |
| POST   | `/sign-in`  | Anyone | Sign in with `email` and `password`, which sets the `token` cookie |
| POST   | `/sign-out` | Anyone | Clear the `token` cookie                                           |

### Users: `/api/users`

| Method | Path   | Who                   | Description                                                         |
| ------ | ------ | --------------------- | ------------------------------------------------------------------- |
| GET    | `/`    | Admin                 | List all users                                                      |
| GET    | `/:id` | That user or an admin | Get one user                                                        |
| PUT    | `/:id` | That user or an admin | Update `name`, `email` or `password`; only admins can change `role` |
| DELETE | `/:id` | That user or an admin | Delete the account                                                  |

### Listings: `/api/listings`

| Method | Path   | Who             | Description                                                                                          |
| ------ | ------ | --------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/`    | Signed in       | List listings, active by default; filter with `?status=active\|sold\|withdrawn`                      |
| GET    | `/:id` | Signed in       | Get one listing                                                                                      |
| POST   | `/`    | Signed in       | Create a listing (`title`, optional `description`, `asking_price`); the seller is the signed-in user |
| PUT    | `/:id` | Seller or admin | Update `title`, `description`, `asking_price` or `status`                                            |
| DELETE | `/:id` | Seller or admin | Delete the listing and its deals                                                                     |

### Deals: `/api/deals`

| Method | Path            | Who                       | Description                                                                                                                     |
| ------ | --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/`             | Signed in, not the seller | Make an offer (`listing_id`, `offer_amount`, optional `message`); the buyer is the signed-in user                               |
| GET    | `/`             | Signed in                 | List deals where you are the buyer or the seller (admins see all); filter with `?status=pending\|accepted\|rejected\|withdrawn` |
| GET    | `/:id`          | Buyer, seller or admin    | Get one deal                                                                                                                    |
| PATCH  | `/:id/accept`   | Seller                    | Accept a pending offer: the listing is sold and other pending offers are rejected                                               |
| PATCH  | `/:id/reject`   | Seller                    | Reject a pending offer                                                                                                          |
| PATCH  | `/:id/withdraw` | Buyer                     | Withdraw a pending offer                                                                                                        |

Common responses: `400` invalid input, `401` not signed in or token invalid, `403` not allowed, `404` not found, `409` the deal or listing is not in the right state (for example accepting a deal that is no longer pending), `429` rate limit exceeded (see the `Retry-After` header).

## Project structure

```
src/
  index.js        loads environment variables, then starts the server
  server.js       starts the HTTP server on PORT
  app.js          middleware order, route mounting, 404 and error handlers
  routes/         maps URLs and HTTP methods to middleware and controllers
  middleware/     authentication (authenticateToken, attachUser, requireRole) and Arcjet security
  controllers/    read requests, run validation, check permissions and state, shape responses
  validations/    Zod schemas for request bodies, URL params and query strings
  services/       business logic and database access with Drizzle
  models/         Drizzle table definitions (users, listings, deals)
  config/         database client, Arcjet, Winston logger, drizzle-kit config
  utils/          JWT, cookie and validation-error helpers
drizzle/          generated SQL migrations
tests/            Jest and Supertest suites
scripts/          dev-setup.sh and prod-setup.sh
```

## Environments and database

| Environment | Database                                                       | Used by                                                                                    |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Production  | The main Neon database                                         | `prod-setup.sh` and `docker-compose.prod.yml`, through `DATABASE_URL` in `.env.production` |
| Staging     | A long-lived Neon branch                                       | Your host machine, through `DATABASE_URL` in `.env`; also the parent of the dev branches   |
| Development | A short-lived Neon branch that Neon Local creates from staging | The `app` container in `docker-compose.dev.yml`                                            |

How migrations flow:

1. Change a model in `src/models/`, then run `npm run db:generate` to create a SQL migration in `drizzle/`.
2. **Dev:** `npm run dev:docker` runs `npm run db:migrate` against **staging** (the `DATABASE_URL` in `.env`) before starting the containers. Neon Local then creates a fresh branch from staging, so the dev database starts with the latest schema. That branch is deleted when the containers stop.
3. **Production:** `npm run prod:docker` runs `scripts/prod-setup.sh`. The script reads `DATABASE_URL` from `.env.production` and migrates the **production** database first. If the migration fails, the app is not started. If it succeeds, it starts the production container and checks that the container stayed up.

More detail on the Docker setup is in [README.docker.md](README.docker.md).

## Running locally

### Prerequisites

- Node.js 20 or later and npm
- Docker Desktop (or Docker Engine with Compose)
- A Neon project with a staging branch, plus a Neon API key
- An Arcjet key

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create the env files from the template. They are git-ignored; never commit real values.

   ```bash
   cp .env.example .env
   cp .env.example .env.development
   cp .env.example .env.production
   ```

   | File               | Set these                                                                                                                                                                                                |
   | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `.env`             | `DATABASE_URL` (the staging branch's connection string), `ARCJET_KEY`                                                                                                                                    |
   | `.env.development` | `ARCJET_KEY`, plus the Neon Local settings `NEON_API_KEY`, `NEON_PROJECT_ID` and `PARENT_BRANCH_ID` (the staging branch's id). `DATABASE_URL` isn't needed; Docker Compose points the app at Neon Local. |
   | `.env.production`  | `DATABASE_URL` (production), `JWT_SECRET` (a long random string), `ARCJET_KEY`                                                                                                                           |

   `JWT_SECRET` is required when `NODE_ENV=production`, and the app refuses to start without it. In development and tests, a built-in dev-only secret is used and a warning is logged.

3. Start the development environment:

   ```bash
   npm run dev:docker
   ```

   This migrates staging, then starts Neon Local and the app with hot reload. The app is at http://localhost:3000. Stop it with `Ctrl+C` or `docker compose -f docker-compose.dev.yml down`.

4. Run the checks:

   ```bash
   npm run lint
   npm run format:check
   npm test
   ```

   The test script sets environment variables inline, so it needs a POSIX shell. On Windows, npm must be configured to run scripts with Git Bash.

### Useful scripts

| Script                               | What it does                                       |
| ------------------------------------ | -------------------------------------------------- |
| `npm run dev`                        | Run the app on the host with `node --watch`        |
| `npm run db:generate`                | Generate a migration from the models               |
| `npm run db:migrate`                 | Apply migrations to the database in `DATABASE_URL` |
| `npm run db:studio`                  | Open Drizzle Studio                                |
| `npm run lint:fix`, `npm run format` | Fix lint and formatting problems                   |

## CI/CD

| Workflow                                            | Runs on                                          | What it does                                                                       |
| --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Lint and Format (`lint-and-format.yml`)             | Pushes and pull requests to `main` and `staging` | Runs ESLint and the Prettier check, and adds annotations for problems              |
| Tests (`tests.yml`)                                 | Pushes and pull requests to `main` and `staging` | Runs Jest with coverage, uploads the coverage report and adds a summary to the run |
| Docker Build and Push (`docker-build-and-push.yml`) | Pushes to `main`, or a manual run                | Builds the production image for `linux/amd64` and pushes it to Docker Hub          |

The usual flow:

1. Work on a feature branch, for example `feature/deals`.
2. Open a pull request into `main` (or `staging`). The Lint and Format and Tests workflows run on the pull request.
3. When the checks pass, merge it.
4. The merge to `main` triggers Docker Build and Push. It publishes `<DOCKER_USERNAME>/acquisitions` tagged `latest`, `main`, the short commit SHA, and `prod-<timestamp>`.

The Docker workflow needs the repository secrets `DOCKER_USERNAME` and `DOCKER_PASSWORD`. Use a Docker Hub access token as the password.

## Testing

`npm test` runs six Jest suites:

| Suite                              | Covers                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.test.js`                      | `/health`, `/api` and the 404 handler                                                                                                                                      |
| `auth.middleware.test.js`          | `attachUser`: valid, missing, invalid and forged tokens                                                                                                                    |
| `authorization-and-errors.test.js` | `requireRole`, admin-only `GET /api/users`, and the global error handler (400, 413, 500)                                                                                   |
| `listings.test.js`                 | Listings endpoints: auth, validation, seller and admin permissions, 404s                                                                                                   |
| `deals.test.js`                    | Deals endpoints: validation, own-listing and non-active-listing rules, duplicate offers, who can view, accept, reject and withdraw, and 409s for deals that aren't pending |
| `rate-limit.test.js`               | That guests, users and admins get the right rate-limit tier                                                                                                                |

The tests need no database or network. Each suite mocks the database config and the service it tests; the API suites also replace the Arcjet middleware with a pass-through, and the rate-limit suite mocks the Arcjet client itself. Because the services are mocked, the SQL in `src/services/` is not exercised by these tests, including the transaction behind accepting an offer. Check those changes against a Neon branch.

## Roadmap

- Deploy to AWS, with the infrastructure defined in Terraform
- Add a deploy job to the pipeline with a manual approval step before production
- Run the app on Kubernetes
- Add monitoring and alerting
