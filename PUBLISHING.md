# Publishing pi-niphant as one GitHub repository

This repository should be published as a single monorepo/toolbox, not as separate repositories per extension or plugin.

## Repo name

```txt
pi-niphant
```

A personal toolbox of Pi extensions/skills and Droid plugins/instructions.

## Repo shape

```txt
README.md
package.json
package-lock.json
.factory-plugin/marketplace.json   # Droid plugin marketplace
scripts/install.sh                  # unified Pi + Droid dispatcher
scripts/install-pi.sh               # Pi symlink installer/uninstaller
scripts/install-droid.sh            # Droid local marketplace installer/uninstaller
scripts/list-packages.mjs           # Pi/Droid inventory

pi/
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

droid/
  droid-catppuccin-ui/
  droid-discord-presence/
```

Each `pi/*` and `droid/*` package remains independently understandable, but users should clone/install the whole toolbox.

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

Install selected surfaces:

```bash
./scripts/install.sh --pi
./scripts/install.sh --droid
./scripts/install.sh --all
./scripts/install.sh pi-workflow droid-discord-presence
./scripts/install.sh --uninstall
```

Droid marketplace-only setup can also be done manually:

```bash
droid plugin marketplace add /path/to/pi-niphant
droid plugin install droid-catppuccin-ui@pi-niphant
droid plugin install droid-discord-presence@pi-niphant
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

Planning/debug artifacts are user-local by design:

```txt
~/.pi/agent/workflows/<project>/...
~/.pi/agent/debugging/<project>/...
~/.factory/...
```

## Pre-push sanity check

```bash
node scripts/list-packages.mjs
npm run check
npm run pack:check --workspace pi-pal-consensus-sidecar
```

The sidecar pack check verifies that the Vite dashboard build and built-in stack JSON are included in the package tarball. If PAL/OpenRouter model availability changed, refresh `pi/pi-pal-consensus-sidecar/test/fixtures/pal-models.json` intentionally and rerun the checks.
