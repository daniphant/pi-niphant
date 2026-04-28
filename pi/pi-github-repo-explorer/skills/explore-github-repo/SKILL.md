---
name: explore-github-repo
description: Clone or refresh a GitHub repository mentioned by the user into a temp checkout and inspect the real code with file-path evidence. Use when the prompt includes a github.com URL, a GitHub PR URL, or an owner/repo reference and asks about architecture, implementation, APIs, files, behavior, or where code should live.
---

# Explore GitHub Repo

Use this skill when the user mentions a GitHub repository and wants answers grounded in the real codebase.

## What this skill does

1. Detects the repository reference from the prompt or surrounding context.
2. Normalizes GitHub URL, SSH URL, PR URL, or `owner/repo` shorthand.
3. Clones or refreshes the repository in a managed temp checkout.
4. Checks out the default branch unless the user specifies a branch, tag, commit, or PR.
5. Uses the checked-out repository to answer with exact file-path evidence.

## Repository selection rules

- If the user mentions exactly one GitHub repo, use it.
- If the user mentions multiple repos and the target is unclear, ask a brief clarification.
- Prefer the most explicit repo reference available:
  1. full GitHub URL
  2. GitHub PR URL
  3. SSH URL
  4. `owner/repo@ref`
  5. plain `owner/repo`
- If the user explicitly names a branch, tag, commit SHA, or PR number, pass it to the helper script.
- If the user provides a GitHub `tree` or `blob` URL whose ref/path split is ambiguous, ask for the exact ref rather than guessing.

## Setup

Run the helper script bundled with this package:

```bash
node ../../scripts/prepare-github-repo-checkout.mjs --repo owner/repo
```

Other valid examples:

```bash
node ../../scripts/prepare-github-repo-checkout.mjs --repo https://github.com/vercel/next.js
node ../../scripts/prepare-github-repo-checkout.mjs --repo vercel/next.js --ref canary
node ../../scripts/prepare-github-repo-checkout.mjs --repo vercel/next.js --pr 123
node ../../scripts/prepare-github-repo-checkout.mjs --repo https://github.com/owner/repo/pull/123
node ../../scripts/prepare-github-repo-checkout.mjs --repo owner/repo@main
```

The script prints JSON describing:
- normalized repo owner/name
- remote URL
- managed clone directory in the temp directory
- default branch
- requested ref or PR, if any
- checkout type
- checked out commit SHA

## Exploration flow

1. Identify the GitHub repo and any explicit ref, tag, commit, or PR.
2. Run `../../scripts/prepare-github-repo-checkout.mjs` with the repo context.
3. Tell the user which repo and checkout were selected.
4. Inspect the checkout directly in the main context for ordinary repo/code exploration.
5. Search broadly, then read the most relevant files; do not rely only on filenames, snippets, README summaries, or repository metadata.
6. Trace important behavior across entrypoints, callers, implementations, schemas/config, and tests before concluding.
7. Synthesize the final answer with exact file paths, line numbers when available, and a short explanation tying each claim to the inspected files.

## Delegation policy

Do not delegate ordinary repository exploration, architecture discovery, or “where does this live?” work. This skill exists so the main model prepares a real checkout, reads files directly, and answers with file-path evidence.

Do not say another agent will inspect the repository, perform follow-up research, or verify later unless the user explicitly requested delegation and the current environment supports it.

Delegation is allowed only when the user explicitly asks to spawn/delegate an objective read-only subtask. If that happens, the delegated task must mention:
- local clone directory from the helper script
- normalized repo name and remote URL
- checkout context: default branch, explicit ref, or PR
- the exact user question
- required output: relevant files, how the flow works, and recommended insertion points when asked where code should live
- read-only constraint

## Search heuristics once the repo is prepared

Start with the files that explain the project shape:
- `README.md`
- `package.json`
- workspace manifests (`pnpm-workspace.yaml`, `turbo.json`, `nx.json`)
- app/package directories (`apps/`, `packages/`, `src/`, `server/`, `cmd/`)
- framework config (`next.config.*`, `vite.config.*`, `tsconfig.json`, `Dockerfile`)

When the user asks about:
- **architecture**: start with `README`, workspace config, app/package roots, and core entrypoints
- **API definition**: start with route/controller/handler files and validation schemas
- **where code should live**: inspect current module boundaries and nearby conventions first
- **request/response shape**: inspect route handlers, controllers, schemas, DTOs, and tests
- **behavior or workflow**: trace from entrypoint to service/use-case/domain logic

## Response requirements

Always state:
- which GitHub repo was used
- which remote URL was used
- which checkout type was used: default branch, branch, tag, commit, or PR
- which local clone directory was explored
- the resolved commit SHA
- exact file paths that support the answer

Evidence quality rules:
- Prefer `path/to/file.ext:line` or `path/to/file.ext:start-end` citations when line numbers are available.
- Cite implementation files, tests, and config/schema files separately when they support different parts of the answer.
- For “where should this live?” answers, cite the existing neighboring files or module boundary that justify the placement.
- For PR or ref-specific questions, make clear that evidence comes from the checked-out PR/ref commit, not just the default branch.
- If the inspected files do not prove a claim, say what was checked and describe the uncertainty instead of filling gaps.

Do not answer from guesswork when repository inspection is the point of the request.
