# AGENTS.md

Instructions for AI agents and contributors working on this app. It is a general-purpose full-stack app template (Nuxt + Hono on Cloudflare); keep domain-specific logic out of the shared setup. See `tech-stack.md` for stack details. `<app-name>` below means the project name set in `package.json` / `wrangler.jsonc`.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Nuxt 4, `ssr: false` (static SPA served by the Worker; code in `app/`) |
| Backend | Hono + zod (`server/`). Node.js locally, Cloudflare Worker when hosted. Single deploy, same-origin, no CORS |
| Database | Cloudflare D1 + Drizzle (`server/db/schema.ts`; migrations in `migrations/`) |
| Object storage | **Local: RustFS** (S3-compatible). **Production: Cloudflare R2** |
| Auth | JWT in a cookie (Hono). Every `/api/*` route is private except login |
| AI | Google AI Studio (Gemini); see `server/routes/ai.ts` |
| Deploy | `wrangler` via GitHub Actions |

## Commands

```bash
npm run dev                 # nuxt dev + hono node (tsx watch server/node.ts), API on :8787
docker compose up -d rustfs # local object storage
npm run db:generate         # drizzle-kit generate
npm run db:migrate:local    # apply migrations to local D1
npm run db:migrate:remote   # apply migrations to remote D1
npm run build               # nuxt generate -> .output/public
npm run deploy              # wrangler deploy
```

## General rules

- Mount every new route in `server/app.ts` under `requireAuth`. Never add a public endpoint without explicit approval.
- Validate all input at trust boundaries with zod.
- D1: use `db.batch([...])` for multiple statements (free tier allows at most 50 queries per invocation).
- Server code must run on both runtimes (Node and Workers). Do not use Node-only APIs (`fs`, heavy `Buffer` use, etc.) anywhere in `server/` except `server/node.ts`.
- Never commit secrets. `.dev.vars` is git-ignored; use `.dev.vars.example` as the template.

## Object storage

Buckets are always **private**. Files are served only through the Worker/Hono (behind auth), using keys stored in D1. Never expose bucket URLs to the client.

### Local: RustFS

RustFS runs via `docker-compose.yml` (S3 API on `:9000`, console on `:9001`). Set these in `.dev.vars`:

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=<app-name>
S3_ACCESS_KEY=rustfsadmin
S3_SECRET_KEY=rustfsadmin
```

- Create the bucket (same name as `S3_BUCKET`) once via the console at `http://localhost:9001` (log in with the credentials above).
- Use path-style addressing (`forcePathStyle`): `http://localhost:9000/<bucket>/<key>`, not virtual-host style.
- Local data lives in the Docker volume `rustfs-data`. Deleting it is safe and resets storage.

#### Alternative: Lerd (Podman), no Docker

If Lerd is installed, it already manages RustFS as a built-in service (Podman container `lerd-rustfs`), so `docker-compose.yml` is not needed. Ports are the same (`:9000` API, `:9001` console); only the credentials differ:

```bash
lerd service list            # check that rustfs is active
lerd service start rustfs    # start it if not running
lerd service status rustfs
```

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=<app-name>
S3_ACCESS_KEY=lerd
S3_SECRET_KEY=lerdpassword
```

- Data is stored in `~/.local/share/lerd/data/rustfs`.
- Do not run Docker Compose and Lerd at the same time: both bind ports 9000/9001.
- You still need to create the bucket once via the console at `http://localhost:9001`.

### Abstraction

Route code must **not** call the R2 binding or an S3 client directly. Add one thin interface (e.g. `server/storage.ts`) exposing `put(key, body, contentType)`, `get(key)`, `delete(key)`, `list(prefix, cursor)`:

- Production (Worker): implement with the `c.env.BUCKET` binding (R2).
- Local (Node): implement with the S3 API against RustFS (e.g. `aws4fetch`, which is small and runs on both runtimes; avoid `@aws-sdk/client-s3` unless truly needed).
- Choose the implementation per runtime in `createApp` / `server/node.ts`. Extend `Env` in `server/app.ts` with optional `S3_*` fields.

Current state: `server/routes/images.ts` still uses `c.env.BUCKET` and flat `crypto.randomUUID()` keys, and `getPlatformProxy` in `server/node.ts` still provides a local R2 via miniflare. Switch to RustFS when the adapter above is built.

### Best practices for grouping files

Object storage is flat: a "folder" is just a key **prefix**. Group files with a key convention, not with extra buckets or real folders.

1. **One bucket per environment, not per entity or feature.** Use the same bucket name locally and in production (the `bucket_name` in `wrangler.jsonc`); separate data by prefix.
2. **Key scheme:** `{domain}/{entity-id}/{kind}/{uuid}.{ext}`
   - Examples: `posts/42/attachments/0f8c…e1.pdf`, `posts/42/images/9a1b…c7.jpg`, `users/7/avatar/3d2e…aa.webp`
   - Order segments from general to specific (`domain` in plural -> `entity-id` -> `kind`) so `list(prefix)` can fetch a whole entity or a single kind.
3. **Keys are immutable and unique.** End with a `uuid` (`crypto.randomUUID()`); never use the original filename. Store the original name, size, and hash in D1 (`original_name`, `size`, `content_type`). To replace a file: upload a new key, update D1, then delete the old key.
4. **Safe characters only:** lowercase letters, digits, `-`, `/`, `.`. No spaces and no PII (names, national IDs, emails) in keys. Avoid `..` and a leading `/`. Always generate keys server-side; never take them raw from client input.
5. **D1 is the source of truth.** The file table stores `key`, the FK to the owning entity, `kind`, metadata, and `created_at`. Query, filter, and sort in D1, not by listing the bucket (slow, billed per operation, not transactional).
6. **Use `list(prefix)` for operations only:** bulk delete, audits, orphan reconciliation. Always paginate with a cursor/continuation token (max 1000 per page).
7. **Delete per entity by prefix.** When an entity is deleted, list its prefix (e.g. `posts/42/`), delete the objects, then delete the D1 rows. Keep the two consistent; if an object delete fails, record it so a reconciliation job can clean up. Never leave orphans silently.
8. **Upload first, then insert into D1** (as `images.ts` does). If the insert fails, delete the object you just uploaded.
9. **Apply lifecycle rules per prefix.** Put temporary or pending uploads under `tmp/` with an expiry rule (R2 lifecycle rule; on RustFS clean up manually or with a job).
10. **Set `Content-Type` on upload.** Validate MIME type and maximum size on the server before writing. Serve with `cache-control: private`.
11. **Keep prefixes shallow** (at most ~4 levels) and keys under 200 characters.
12. **Local/production parity.** The key scheme must be identical on RustFS and R2 so data and tests move between them without conversion.

## Code conventions (Ponytail style)

Principle: the best code is the code never written. Solve the whole problem with the smallest change. Take the first option that fully works:

1. Does it need to exist? Skip features, options, and flexibility nobody asked for, and name what you skipped in one line.
2. Is it already in the codebase (helper, component, pattern)? Use it the way the surrounding code does.
3. Does the standard library or platform (Web APIs, Workers, Hono, Nuxt) cover it? Use that.
4. Is there an installed dependency that covers it? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? Write one line. Otherwise write the minimum code that works.

Derived rules:

- No abstractions, wrappers, options, config, or "for later" code that was not requested. Deleting beats adding.
- Be lazy about the solution, never about the scope: finish every part the task touches (callers, tests, fixtures, config, exports).
- **Bug fixes:** grep every caller of the function you change, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Comment only the "why" the code cannot show, in one line. Match the comment density of the surrounding file.
- A shortcut with a known limit gets a comment: `// shortcut: <the limit>, <when to upgrade>`.
- New non-trivial logic (branches, loops, parsers, money, security, new scripts) ships with one small test or assert. Trivial changes need none.
- Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, or anything the user asked for.
- Follow the existing style: TypeScript ESM, no semicolons, single quotes, 2-space indent (see `server/app.ts`). Naming: `camelCase` for variables and functions, `PascalCase` for types and Vue components, `kebab-case` for non-component filenames.
- End every change report with one or two lines: what you skipped or did not check, and any risk the user must know.

## Git conventions

- `main` is the default branch and must always be deployable (a push to `main` auto-deploys). Work on branches named `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`, or `docs/<short-name>` (lowercase, `-` as separator).
- Commits follow Conventional Commits: `<type>(<scope>): <imperative summary, lowercase, no trailing period>`. Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `ci`. Example scopes: `auth`, `images`, `ai`, `db`, `app`.
  - Example: `feat(images): group object keys by entity prefix`
- One commit = one logical change. Commit Drizzle schema changes together with the migration file generated by `db:generate` and the code that uses it.
- Never edit a migration already on `main`; add a new one.
- Never commit `.dev.vars`, secrets, `.output/`, `node_modules/`, or RustFS data.
- Merge to `main` through a Pull Request. The PR title follows the commit format; the description states what changed, why, and how to test it. Prefer squash merge. Never force-push to `main`.
- Agents must not commit or push unless asked.

## CI/CD

The workflow is `.github/workflows/deploy.yml`: push to `main` -> `npm ci` -> `npm run build` -> `wrangler d1 migrations apply DB --remote` -> `wrangler deploy`. Order matters: migrations run before the new code is deployed.

Required GitHub secrets: `CLOUDFLARE_API_TOKEN` (Workers, D1, R2 permissions) and `CLOUDFLARE_ACCOUNT_ID`. Set runtime secrets (`JWT_SECRET`, `GEMINI_API_KEY`) once with `npx wrangler secret put <NAME>`; never put them in the repo or the workflow.

Guidelines:

- **Migrations must be backward-compatible** (add columns/tables first, remove later). Remote migrations run before the new code goes live, and there is no automatic rollback.
- Before pushing, run locally: `npm run build` and `npx tsc --noEmit`. There is no `lint` or `test` script yet; if one is added, run it in CI too.
- Recommended: add a `check` job on `pull_request` (`npm ci`, `tsc --noEmit`, `npm run build`) without Cloudflare secrets, and require it before merge. Today the workflow runs only on push to `main`, so nothing is checked before merge.
- `database_id` in `wrangler.jsonc` is still `REPLACE_ME`. Set the real D1 ID and create the R2 bucket named in `wrangler.jsonc` in the Cloudflare account before the first deploy.
- The frontend (static) and the Worker ship together in one `wrangler deploy`; there is no separate frontend deploy.
- Rollback: `npx wrangler rollback` for code; undo data/schema changes with a new migration.

## AI skills

Skills are listed in `list-skills.md` / `skills-lock.json` (install with `npx skills add ...`). Pick by use case:

| Use case | Skill |
|----------|-------|
| Write or change Hono routes, middleware, RPC | `hono` |
| Deploy, D1/R2 bindings, `wrangler.jsonc`, remote migrations | `wrangler` |
| Auth, JWT cookie, input validation, file upload, security review | `security-and-hardening` |
| Design entities, relations, and the D1/Drizzle schema | `domain-modeling` |
| Stress-test a feature plan or design before coding (step-by-step interview against docs and code) | `grill-with-docs` |
| Probe a non-code decision or idea until it is settled | `grilling` |
| Nuxt UI/pages: design, polish, visual audit | `impeccable` |
| Remove "AI slop" style from text or UI output | `antislop` |
| Slow queries, large bundles, cold starts, caching | `performance-optimization` |
| Create or update `README.md` | `create-readme`, `readme-blueprint-generator` |

Usage rule: one primary skill per task. For a new feature the usual order is `grill-with-docs` -> `domain-modeling` -> `hono` / `impeccable` -> `security-and-hardening` -> `wrangler`.
