---
name: workflow-start
description: Front door for starting a durable Pi workflow from a raw request. Use /workflow <request> for frictionless start; use /workflow --name <slug> -- <request> only when overriding the inferred slug.
---

# Workflow Start

Use this as the discovery/front-door skill when the user asks to start or use the workflow system for a new task. `/workflow <request>` also routes here so the assistant, not the user, chooses the concise workflow name.

## Goal

Ensure new workflows are created through `/workflow <request>` by default. The command handler infers a concise safe name and immediately creates/resumes the workflow bundle. Use the explicit `/workflow --name <slug> -- <request>` form only when the user supplied or explicitly wants a particular name.

## Context hygiene

Do not read unrelated `SKILL.md` files, enumerate installed skills, or inspect other workflow-stage docs while choosing the slug. Use only this skill and the user's request. Load another skill only when the user explicitly requests it.

## Trigger phrases

Use this skill when the user says things like:

- "use workflow for ..."
- "start a workflow ..."
- "let's run this through workflow"
- "plan this with the workflow"
- "start research/spec/plan/execute for ..."
- "we should use the staged workflow"

## Required behavior

1. Extract the full request that should become the workflow request.
2. Start via the unnamed command form unless the user asked for a specific slug:

```text
/workflow <full request>
```

3. If the user asked for a specific name, normalize it to a concise Codex-CLI-style slug and use the explicit override form:
   - 2-4 short words.
   - Kebab-case only: `a-z`, `0-9`, and `-`.
   - Max 32 characters.
   - Prefer concrete nouns/verbs from the request.
   - Avoid generic prefixes like `plan`, `workflow`, `task`, or `feature`.
   - Never include whitespace, path separators, shell metacharacters, or `..`.

```text
/workflow --name <slug> -- <full request>
```

## Important

- Do not start Stage 1 manually by writing workflow artifacts yourself.
- Do not skip the `/workflow` command; it performs niphant preflight, creates/resumes worktrees when enabled, validates/infers slugs, creates the workflow bundle, and emits the Stage 1 prompt.
- If you cannot execute slash commands directly in the current interface, reply with exactly the command the user should run, with no extra prose.

## Examples

User request:

```text
use workflow to fix the overly long generated workflow commands
```

Command:

```text
/workflow fix the overly long generated workflow commands
```

User request:

```text
start a workflow for making auth errors easier to debug
```

Command:

```text
/workflow making auth errors easier to debug
```
