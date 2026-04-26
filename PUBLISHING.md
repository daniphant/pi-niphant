# Publishing pi-niphant as one GitHub repository

This repository should be published as a **single monorepo/toolbox**, not as separate repositories per extension.

That shape matches the GStack/Superpowers model: one repo, many composable skills/extensions, one installation story.

## Repo name

```txt
pi-niphant
```

A trunkful of opinionated Pi extensions and skills.

## What lives in the repo

```txt
README.md                 # top-level toolbox overview
package.json              # npm workspaces + root scripts
scripts/install.sh        # symlink installer/uninstaller
scripts/list-packages.mjs # package inventory

pi-workflow/
pi-checkpoint/
pi-codex-compaction/
pi-pal-consensus-sidecar/
pi-web-e2e-agent/
pi-web-tools/
pi-diagnostics/
pi-markdown-commands/
pi-delegation-guard/
pi-delegated-agents/
pi-clear/
pi-agent-notify/
pi-hud/
pi-whimsy-status/
pi-github-repo-explorer/
```

Each `pi-*` directory remains independently understandable with its own README/package metadata, but users should clone/install the whole toolbox.

## Publish the monorepo

```bash
git init
git add .
git commit -m "Initial pi-niphant release"
git branch -M main
gh repo create daniphant/pi-niphant --public --source=. --remote=origin --push
```

If the repo already exists:

```bash
git remote add origin https://github.com/daniphant/pi-niphant.git 2>/dev/null || true
git add .
git commit -m "Update pi-niphant" || true
git branch -M main
git push -u origin main
```

## Install from the published repo

```bash
git clone https://github.com/daniphant/pi-niphant.git
cd pi-niphant
./scripts/install.sh
```

Then inside Pi:

```text
/reload
```

Install everything including explicit delegated-agent orchestration:

```bash
./scripts/install.sh --all
```

Install selected tools:

```bash
./scripts/install.sh pi-workflow pi-pal-consensus-sidecar pi-diagnostics pi-web-e2e-agent pi-web-tools
```

Uninstall symlinks:

```bash
./scripts/install.sh --uninstall
```

## Important non-repo artifacts

These should never be published/committed:

```txt
.pi/
.scratch/
node_modules/
dist/
coverage/
*.log
.env*
```

The root `.gitignore` excludes them.

Planning/debug artifacts are user-local by design:

```txt
~/.pi/agent/workflows/<project>/...
~/.pi/agent/debugging/<project>/...
```

## Updated packages in this release

Major new/updated toolbox pieces:

- `pi-workflow`
- `pi-checkpoint`
- `pi-codex-compaction`
- `pi-pal-consensus-sidecar`
- `pi-web-e2e-agent`
- `pi-diagnostics`
- `pi-markdown-commands`
- `pi-delegation-guard`
- `pi-clear`

Existing pieces still included:

- `pi-agent-notify`
- `pi-delegated-agents`
- `pi-github-repo-explorer`
- `pi-hud`
- `pi-whimsy-status`

## Pre-push sanity check

```bash
node scripts/list-packages.mjs
npm run check
npm run pack:check --workspace pi-pal-consensus-sidecar
```

The sidecar pack check verifies that the Vite dashboard build and built-in stack JSON are included in the package tarball. If PAL/OpenRouter model availability changed, refresh `pi-pal-consensus-sidecar/test/fixtures/pal-models.json` intentionally and rerun the checks.
