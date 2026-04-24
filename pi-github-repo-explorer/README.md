# pi-github-repo-explorer

A small Pi package that adds a skill for exploring GitHub repositories from real code instead of guessing.

## What it does

The `explore-github-repo` skill:
- activates when a prompt mentions a GitHub repository URL, PR URL, or `owner/repo` reference
- normalizes the repo reference
- clones or refreshes a managed temp checkout
- checks out the default branch, or an explicit branch / tag / commit / PR when provided
- guides Pi to answer with exact file-path evidence

## Install

```bash
pi install /Users/daniphant/projects/pi-extensions/pi-github-repo-explorer
```

Or add it to Pi settings as a local package path.

## Direct usage

You can force the skill with:

```bash
/skill:explore-github-repo https://github.com/vercel/next.js
/skill:explore-github-repo owner/repo@main
/skill:explore-github-repo https://github.com/owner/repo/pull/123
```

## Helper script

The skill uses:

```bash
node ./scripts/prepare-github-repo-checkout.mjs --repo owner/repo
```

Examples:

```bash
node ./scripts/prepare-github-repo-checkout.mjs --repo https://github.com/vercel/next.js
node ./scripts/prepare-github-repo-checkout.mjs --repo vercel/next.js --ref canary
node ./scripts/prepare-github-repo-checkout.mjs --repo https://github.com/owner/repo/pull/123
node ./scripts/prepare-github-repo-checkout.mjs --repo owner/repo@main --dry-run
```

The script prints JSON describing the normalized repo, managed clone directory, checkout choice, and resolved commit.
