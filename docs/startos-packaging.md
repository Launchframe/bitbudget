# StartOS packaging

Internal knowledge base for packaging BitBudget (and related services) as StartOS `.s9pk` services. Official reference: [Start9 Service Packaging (0.4.x)](https://docs.start9.com/packaging/0.4.0.x/).

## Goals

- Run BitBudget on user-owned hardware via StartOS, with privacy/sovereignty aligned with product ethos.
- Maintain a repeatable packaging workflow (build, test, publish, update).
- Support both **private distribution** (sideload / self-hosted registry) and, if we choose it, the **Start9 Community Registry**.

This repo does **not** yet contain a `*-startos` package; packaging will live in a separate repository (convention: `bitbudget-startos`) cloned from [hello-world-startos](https://github.com/Start9Labs/hello-world-startos).

---

## What a StartOS package is

StartOS installs **services**, not arbitrary binaries. Each service is a **`.s9pk`** archive: TypeScript package metadata + Docker image(s) + lifecycle hooks (install, update, uninstall, health, actions, interfaces, dependencies).

The wrapper can:

- Run code on install, update, and uninstall
- Expose LAN / Tor / clearnet interfaces
- Define user-facing actions and tasks
- Declare dependencies on other StartOS services (e.g. PostgreSQL)
- Offer encrypted backups of selected volumes

Packaging is intentionally separate from the main application repo: the app is containerized; the `*-startos` repo describes how StartOS runs and upgrades it.

---

## Toolchain

| Tool | Role |
|------|------|
| [start-cli](https://github.com/Start9Labs/start-cli) | Validate, pack, publish `.s9pk` |
| Docker | Build container images embedded in the package |
| Node.js 22 (LTS) | Compile TypeScript manifest / `main` / versions |
| GNU Make + `s9pk.mk` | `make` → `.s9pk`; optional `make install` to a dev device |
| squashfs-tools | Filesystem images inside the package |
| StartOS device or VM | End-to-end install/update testing |

Install and verify per [Environment Setup](https://docs.start9.com/packaging/0.4.0.x/environment-setup.html).

Recommended AI-assisted layout (optional): workspace with `start-docs/`, `CLAUDE.md` from Start9, and your `*-startos` repo alongside—not inside—the package repo.

---

## Project layout (typical `*-startos` repo)

```
my-service-startos/
├── Makefile              # includes s9pk.mk
├── s9pk.mk               # shared build targets (from template)
├── package.json
├── docker/               # Dockerfiles
├── startos/
│   ├── manifest/         # metadata, images, release notes
│   ├── main.ts           # daemons, health, lifecycle
│   ├── versions/         # ExVer graph + migrations
│   └── init/             # setupOnInit, seed files, tasks
└── README.md             # user-facing; no version numbers in README (Start9 rule)
```

See [Project Structure](https://docs.start9.com/packaging/0.4.0.x/) and [Recipes](https://docs.start9.com/packaging/0.4.0.x/recipes.html) for patterns (dependencies, backups, interfaces, etc.).

---

## Development workflow

### 1. Bootstrap

- Create repo from [hello-world-startos](https://github.com/Start9Labs/hello-world-startos) (GitHub “Use this template” → name `something-startos`).
- Clone, `npm install`, adapt `manifest`, Dockerfiles, and `main` for your service.

### 2. Build

```bash
npm install
make              # all arches, or: make x86 | make arm | make universal
```

Produces e.g. `hello-world_x86_64.s9pk` in the project root.

### 3. Install on a dev StartOS server

**Option A — Sideload:** StartOS UI → **Sideload** → upload `.s9pk`.

**Option B — CLI install:** Configure `~/.startos/config.yaml` with `host: http://your-server.local`, then:

```bash
make install
```

### 4. Iterate

Use [Recipes](https://docs.start9.com/packaging/0.4.0.x/recipes.html) for Postgres, reverse proxy, env secrets, health checks, etc. Test install → start → UI → health green → uninstall → reinstall.

---

## Distribution: getting packages onto devices

Every `.s9pk` must be reachable through a **registry** (URL users add in StartOS). You are not required to use Start9’s registry.

### Path A — Self-hosted registry (full control)

1. Install a registry service on StartOS (e.g. from an existing registry package).
2. Expose it (LAN, Tor `.onion`, or clearnet).
3. Publish:

```bash
start-cli s9pk publish \
  --url=https://my-registry.example.com \
  myservice_x86_64.s9pk
```

4. Users add your registry URL and install/update from the catalog.

Reference: [Publishing — Self-Hosted Registry](https://docs.start9.com/packaging/0.4.0.x/publishing.html).

### Path B — Start9 Community Registry (“marketplace”)

Current process is **email + GitHub**, not self-service (developer portal planned).

| Stage | Registry URL | How builds arrive |
|-------|----------------|-------------------|
| **alpha** | `https://community-alpha-registry-x.start9.com` | **Automatic** on merge to Start9-Community fork |
| **beta** | `https://community-beta-registry.start9.com` | Request via `submissions@start9.com` or fork issue |
| **production** | `https://community-registry.start9.com` | Request after beta soak |

**Initial submission**

1. Email **submissions@start9.com** with a link to a **public** GitHub repo.
2. Start9 forks into [Start9-Community](https://github.com/Start9-Community); you address feedback via PRs to **that fork** (fork becomes upstream for the pipeline).

**Ongoing changes**

1. Open PR on the community fork.
2. On merge → CI builds, tags, publishes to **community-alpha** (no manual `start-cli publish` for that step).
3. Email/issue to promote to beta, then production.

You can run a **private alpha registry** in parallel while community builds mature.

**Pre-publish checklist** (required before community PR merge — bad merges ship straight to alpha):

1. Git tag matches [Git Tag Conventions](#git-tags-and-releases) (below).
2. `tsc --noEmit`, tests, and pack step green.
3. README matches actions, volumes, ports, dependencies (no version numbers in README).
4. Tested end-to-end on StartOS (install, update path if applicable, uninstall/reinstall).

---

## Releasing software updates to StartOS packages

This is the full loop from “new app or wrapper code” to “users can upgrade on their server.” It spans **version numbering**, **migrations**, **build/publish**, and **what happens on the device**.

### Overview

| Layer | Who acts | What happens |
|-------|----------|----------------|
| **Version & migrations** | Maintainer in `*-startos` repo | Bump ExVer, add/change `startos/versions/*`, implement `up`/`down` if data must move |
| **Build artifact** | `make` / CI | New `.s9pk` for each arch (or universal) |
| **Registry** | You or Start9 automation | New package revision indexed at registry URL |
| **User device** | Server owner | StartOS shows update when registry has newer version; user approves update (same trust model as install) |

Updating **StartOS itself** (the OS) is a separate flow from updating **installed services**. Service updates are driven by the registry + package version graph.

### Extended versioning (ExVer)

StartOS uses **Extended Versioning** so wrapper releases can move independently of upstream app releases.

Format:

```
[#flavor:]<upstream>[-upstream-prerelease]:<downstream>[-downstream-prerelease]
```

| Part | Meaning | Example |
|------|---------|---------|
| `flavor` | Optional fork identifier (not for GPU/hardware variants) | `#libre:` |
| `upstream` | Upstream app version (SemVer) | `26.0.0` |
| `upstream-prerelease` | Upstream pre-release | `-beta.1` |
| `downstream` | StartOS wrapper revision | `0`, `1`, `2` |
| `downstream-prerelease` | Wrapper pre-release | `-alpha.0`, `-beta.0` |

Examples: `26.0.0:0` (stable wrapper 0 on upstream 26.0.0), `2.3.2:1-beta.0` (wrapper 1 beta on upstream 2.3.2).

**When to bump what**

| Change type | Upstream | Downstream | Typical action |
|-------------|----------|------------|----------------|
| New upstream app release (e.g. BitBudget tag `v1.2.0`) | Bump to match | Reset to `0` | New Docker tag, submodule/tag, new version file |
| Wrapper-only (manifest, health, StartOS UX, pin) | Unchanged | Increment (`0` → `1`) | Often update version file in place (see below) |
| Alpha iteration (`-alpha.0` → `-alpha.1`) | May be unchanged | Prerelease bump | **Rename version file in place**; keep `other: []` |
| Promote alpha → beta → stable | Unchanged or bumped | Drop or advance prerelease | **New version file**; move old `current` into `other` for migration chain |

Keep **Docker image tag**, **git submodule tag** (if used), and **version file** in sync for upstream `X.Y.Z`. See [Versions](https://docs.start9.com/packaging/0.4.0.x/versions.html).

Version files live under `startos/versions/` (e.g. `v1.0.0.0.a0.ts` for `1.0.0:0-alpha.0`). `index.ts` exports `versionGraph` with `current` and `other` (historical versions that need migration edges).

### Migrations on update

When a user moves from version A → B, StartOS runs **`migrations.up`** from the version graph path. Use this only for **wrapper-owned state** (configs, volumes, StartOS stores)—not for data the upstream app migrates itself (e.g. Prisma inside the container).

```typescript
migrations: {
  up: async ({ effects }) => { /* move config, reshape files */ },
  down: IMPOSSIBLE, // or rollback when safe
}
```

Use `IMPOSSIBLE` for `down` on initial versions or irreversible changes.

**When to add a new version file vs edit in place**

- **New file:** new `up`/`down` migration, or you want prior release notes preserved in git history.
- **Edit in place:** wrapper-only bump with no migration and no need to keep old notes file; rename file to new version string and update `version` + `releaseNotes`.

### Git tags and releases

Releases are tied to **git tags**. Format ([Versions — Git Tag Conventions](https://docs.start9.com/packaging/0.4.0.x/versions.html)):

```
v{upstream}_{downstream}[-prerelease]
```

Colon in ExVer becomes underscore in the tag (tags cannot contain `:`).

| Package version | Git tag |
|-----------------|---------|
| `26.0.0:0` | `v26.0.0_0` |
| `0.13.5:0-alpha.0` | `v0.13.5_0-alpha.0` |
| `2.1.0:7-beta.5` | `v2.1.0_7-beta.5` |

Push tags explicitly: `git push origin <tag>` (avoid blind `git push --tags`).

### Release workflow by distribution channel

#### Self-hosted registry

1. Implement version bump + migrations (if any).
2. Update `releaseNotes` in the version module (localized strings in `VersionInfo`).
3. Run pre-publish checks (build, verify, README, on-device test **including upgrade from previous version**).
4. `make` (or CI) to produce `.s9pk`.
5. `start-cli s9pk publish --url=<registry> <file>.s9pk`.
6. Users with your registry configured see the new version and can update from the StartOS UI.

#### Start9 Community Registry

1. Same version/migration/README/testing work on the **Start9-Community fork**.
2. Open PR → review → **merge**.
3. Automation builds, tags, and deploys to **community-alpha** (you do not run publish yourself for that step).
4. When ready for wider exposure: email **submissions@start9.com** or open a fork issue to promote **alpha → beta → production**.

Every version bump is **another PR** through the same pipeline; merge always lands on alpha first.

### Maintainer release checklist (each version)

Use this for every release, not only the first publish:

- [ ] ExVer string and git tag aligned; Docker/submodule tags match upstream if applicable
- [ ] `releaseNotes` updated (all required locales in template)
- [ ] Migration `up` tested from **previous shipped** version (not only fresh install)
- [ ] `down` behavior understood (`IMPOSSIBLE` documented if used)
- [ ] `tsc --noEmit`, tests, pack/verify green
- [ ] README still accurate (no version numbers in README body)
- [ ] Installed on dev StartOS: upgrade path green, health checks pass, critical actions work
- [ ] Publish path executed (self-hosted `start-cli publish` or community PR merged)
- [ ] If community: note whether this build should stop at alpha or be promoted to beta/prod

### What users experience

1. Their StartOS server checks registries they trust.
2. When a **newer package version** exists for an installed service, the UI offers an **update** (user-initiated; not silent forced upgrade of the service).
3. StartOS downloads the new `.s9pk`, runs version migrations, restarts daemons per `main` / health configuration.
4. If something fails, logs and health checks surface in the service detail UI; maintainers document rollback/limitations in README and release notes.

For breaking changes, use release notes and optional manifest **alerts** to warn before or during update.

---

## BitBudget-specific considerations (draft)

Packaging BitBudget is feasible but non-trivial compared to a single-container app:

| Area | Notes |
|------|--------|
| **Stack** | Next.js + PostgreSQL + Prisma; likely app container + Postgres as StartOS **dependency** or bundled sidecar |
| **Secrets** | `AUTH_SECRET`, DB URL, encryption-related config via StartOS file models / stores—not baked into image |
| **Integrations** | Plaid, OAuth (Google/GitHub), email OTP, SMS, Nostr may need clearnet egress or documented “optional / off on StartOS” |
| **Privacy** | Client-side encryption model unchanged; server must not log decrypted fields; align with AGENTS.md |
| **Updates** | App schema via Prisma migrations inside container; wrapper migrations only for StartOS-mounted config/volumes |
| **Backups** | Define volumes for DB and any uploaded assets; test restore on `kind: 'restore'` in `setupOnInit` |

Treat **v1 StartOS** as a scoped slice (e.g. self-hosted vanilla, no Plaid) unless we explicitly design for full integration parity.

---

## References

| Topic | URL |
|-------|-----|
| Packaging index | https://docs.start9.com/packaging/0.4.0.x/ |
| Quick start | https://docs.start9.com/packaging/0.4.0.x/quick-start.html |
| Environment setup | https://docs.start9.com/packaging/0.4.0.x/environment-setup.html |
| Publishing & community pipeline | https://docs.start9.com/packaging/0.4.0.x/publishing.html |
| Versions & migrations | https://docs.start9.com/packaging/0.4.0.x/versions.html |
| Makefile / `make install` | https://docs.start9.com/packaging/makefile.html |
| Hello World template | https://github.com/Start9Labs/hello-world-startos |
| Community submission | submissions@start9.com |

---

## Related internal docs

- [CI](./ci.md) — GitHub Actions for this application repo (separate from StartOS package CI on the fork).
- [AGENTS.md](../AGENTS.md) — privacy, encryption, and product constraints that apply to any StartOS build.
