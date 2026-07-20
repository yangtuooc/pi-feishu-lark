# Contributing

## Branching

| Branch | Purpose |
|--------|---------|
| `main` | Always releasable. Protected. Default base for PRs. |
| `feat/*`, `fix/*`, `docs/*`, `chore/*` | Short-lived topic branches from `main`. |
| `vX.Y.Z` tags | Immutable release points (created by Release Please). |

We do **not** use long-lived `develop` / `release/*` branches for this package.

```text
feature branch ──PR──▶ main ──(Release Please)──▶ Release PR ──merge──▶ tag vX.Y.Z + GitHub Release
                                                                              │
                                                                              ▼
                                                                        npm publish
```

## Versioning (SemVer)

We follow [Semantic Versioning](https://semver.org/):

| Change | Bump | Commit prefix examples |
|--------|------|------------------------|
| Breaking API / behavior | **MAJOR** (`1.0.0`) | `feat!: …`, `fix!: …`, or footer `BREAKING CHANGE:` |
| New backward-compatible feature | **MINOR** (`0.5.0`) | `feat: …` |
| Bug fix / docs / chore | **PATCH** (`0.4.1`) | `fix:`, `docs:`, `chore:`, `test:`, `ci:` |

While the major version is `0.x`, Release Please is configured with:

- `bump-minor-pre-major: true` — `feat` may bump minor under `0.x`
- `bump-patch-for-minor-pre-major: true` — non-feat commits bump patch under `0.x`

Do **not** hand-edit `package.json` version for routine releases. Release Please owns version bumps.

## Conventional Commits

Commit messages must be [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types: `feat`, `fix`, `docs`, `chore`, `test`, `ci`, `refactor`, `perf`.

Examples:

```text
feat: parse nested interactive card columns
fix: avoid silent ignore on empty post lists
docs: document FEISHU_STREAMING_REPLY
feat!: rename env FEISHU_TIMEOUT to FEISHU_PROMPT_TIMEOUT_MS

BREAKING CHANGE: callers must migrate the env var name.
```

## Release flow (GitHub mainstream)

1. Land work on `main` via PR (CI must pass).
2. **Release Please** (`release-please.yml`) opens/updates a Release PR that:
   - bumps `package.json` version
   - updates `CHANGELOG.md`
   - updates `.release-please-manifest.json`
3. Maintainer reviews and merges the Release PR.
4. Release Please creates:
   - git tag `vX.Y.Z`
   - GitHub Release with changelog notes
5. **Publish** (`publish.yml`) runs automatically when a `v*` tag is pushed
   (Release Please does this on Release PR merge). It also listens to
   `release: published` and supports manual `workflow_dispatch`.
   - checks out the tag
   - verifies tag version == `package.json`
   - runs `check` + `test`
   - `npm publish --access public --provenance` (skips if version already on npm)

### Manual / hotfix publish

Use workflow dispatch on **Publish npm** with an existing tag, or:

```bash
git checkout v0.4.1
npm ci && npm run check && npm test
npm publish --access public
```

## Local development

```bash
npm ci
npm run check
npm test
```

## PR checklist

- [ ] Conventional Commit title (or clean history to squash)
- [ ] `npm run check` and `npm test` pass
- [ ] User-facing changes reflected in docs if needed
- [ ] No secrets in the tree
