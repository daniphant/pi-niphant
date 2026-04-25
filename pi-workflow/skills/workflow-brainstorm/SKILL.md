---
name: workflow-brainstorm
description: Stage 1 after /workflow has created a split workflow bundle. Interview, brainstorm, research, challenge assumptions, and update workflow.research.md. Refuse bundle-less manual use. Do not write implementation code.
---

# Workflow Brainstorm / Research

This is Stage 1 after `/workflow` creates a user-local workflow bundle under `~/.pi/agent/workflows/<project>/<id>/`.

The bundle uses focused files:

- `workflow.research.md` — Stage 1 research log. This is the only file normally edited in this stage.
- `workflow.spec.md` — Stage 2 spec.
- `workflow.plan.md` — Stage 3 implementation plan.
- `workflow.toml` — execution/task state only, populated from the final plan and updated during implementation.

Workflow files should not be committed to project git.

## Context hygiene

Do not read unrelated `SKILL.md` files or enumerate installed skills during research. Broader code exploration is allowed, but inspect other skill docs only when the workflow request is about skills/Pi behavior, the user explicitly asks, or a skill is directly required for validation/tooling.

## Bundle requirement

Refuse to run if the prompt does not include concrete workflow file paths and no provided path resolves to a workflow directory or `workflow.toml`. Stage 1 requires a workflow bundle so `/clear` continuation has durable paths. On refusal:

- explain that bundle-less brainstorm cannot safely continue through the workflow stages;
- tell the user to start with `/workflow <request>`;
- do not perform ad-hoc research;
- do not write project code or workflow artifacts.

## Goal

Reach shared understanding, classify complexity, and record the next route before any spec, plan, or implementation work.

Operate like a relentless design interview, not a one-shot questionnaire: interview the user about every unresolved aspect of the request until there is shared understanding. Walk the design tree branch-by-branch, resolving dependencies between decisions one at a time. For each question, provide your recommended answer so the user can accept, reject, or refine it quickly.

## Rules

- Do not implement code.
- Do not create tests, migrations, schemas, or app code.
- You may read code, search files, inspect docs, and update `workflow.research.md`.
- Do not update `workflow.toml` during research except to fix broken file references; it is for execution/task state only.
- Do exploration yourself in the main context. Do not delegate ordinary code exploration.
- Ask questions aggressively, but ask them one at a time.
- Do not dump a list of questions. Pick the single highest-leverage unresolved decision, ask it, and wait.
- For every question, include your recommended answer and a short reason.
- If a question can be answered by reading/exploring the codebase, answer it yourself instead of asking the user.
- For non-trivial product/API/architecture/UX work, do not finalize Stage 1 in the same turn as the initial `/workflow` kickoff unless there are truly no user-preference decisions left. Usually ask at least one question before the final handoff.
- Do not copy all research into `workflow.spec.md` or `workflow.plan.md`.
- Do not automatically invoke spec, plan, execute, or implementation. Stop with a handoff.

## Process

1. Read `workflow.research.md` and verify workflow bundle paths.
2. Understand the user's motivation:
   - why this matters
   - what pain exists today
   - who is affected
   - what happens if we do nothing
   - smallest viable version
3. Explore existing code/patterns directly:
   - similar implementations
   - relevant modules/files/symbols
   - tests/quality anchors
   - configuration/schema/API boundaries
   - recent git history if helpful
4. Challenge assumptions:
   - simpler alternatives
   - edge cases
   - consistency implications
   - sequencing and dependencies
5. Interview loop for unresolved decisions:
   - Identify dependencies between decisions and choose the next blocking branch.
   - Treat product intent, UX preference, scope boundaries, risk tolerance, security/privacy defaults, and API compatibility as user-preference decisions unless the request already states them clearly.
   - If code/docs can resolve the branch, explore them directly and record the finding.
   - Otherwise ask exactly one targeted question.
   - Include your recommended answer and why.
   - Stop the turn after the question. Do not append a Stage 2/plan handoff in the same response.
   - Wait for the user's answer before asking the next question or finalizing research.
   - Continue the loop until the remaining unknowns are non-blocking or explicitly deferred by the user.
6. Update `workflow.research.md` throughout with:
   - problem/opportunity
   - motivation
   - goals/non-goals
   - open questions
   - decisions made
   - alternatives considered
   - reference implementations with paths
   - risks/unknowns
   - the complete `## Complexity / Route Recommendation` section.

## Complexity classification

Use these tiers:

- **trivial**: localized obvious change, usually one file, no public API/UX/data/security behavior, validation is obvious, and the user explicitly accepts skipping workflow tracking.
- **small**: low-risk known pattern, limited files, no unresolved product semantics, but still benefits from a plan and browser review.
- **moderate**: multiple files or behavior semantics, meaningful tradeoffs, requires a plan and optional consensus prompt after plan.
- **large**: architecture, cross-package behavior, migrations, auth/security/privacy, public API changes, ambiguous product requirements, or high rollback risk; requires spec and plan.

## Route Decision Contract

`workflow.research.md` must contain a stable section named exactly:

```markdown
## Complexity / Route Recommendation
```

Populate these labels exactly:

```markdown
- Complexity: trivial | small | moderate | large
- Recommended route: <human-readable route>
- Spec: required | skipped - <rationale>
- Plan: required | skipped - <rationale>
- Consensus: none | available_on_request | prompt_after_plan | prompt_after_spec_and_plan
- Browser review: skipped_for_trivial | required_after_plan | required_after_spec_and_plan
- Execution source: research | plan
- Trivial execution approved: true | false
- Workflow task tracking: enabled | skipped_for_trivial
- Next command after /clear: /workflow-...
```

Rules:

- Non-trivial workflows must set `Execution source: plan` and `Workflow task tracking: enabled`.
- Trivial workflows may set `Execution source: research` only when all trivial skip markers are explicit.
- `/workflow-execute` must refuse research-only execution unless the research file includes:
  - `Complexity: trivial`
  - `Spec: skipped`
  - `Plan: skipped`
  - `Consensus: none`
  - `Browser review: skipped_for_trivial`
  - `Execution source: research`
  - `Trivial execution approved: true`
  - `Workflow task tracking: skipped_for_trivial`
- If any marker is absent or incompatible, execution must list missing markers and suggest `/workflow-plan <workflow>`.

## Naming

`/workflow <request>` infers a concise slug before creating paths/worktrees. When you are explicitly overriding a name for a raw user request, use a concise Codex-CLI-style slug:

- 2-4 short words, kebab-case, max 32 characters.
- Prefer concrete nouns/verbs from the request.
- Avoid generic prefixes like `plan`, `workflow`, `task`, or `feature`.
- Pass it down as `/workflow --name <slug> -- <full user request>` only for explicit name overrides.

## Exit / Handoff

Only exit research after the interview loop has converged: the important design branches are resolved, answered from code/docs, or intentionally deferred by the user. Do not end a brainstorm turn by both listing multiple open questions and telling the user to continue to spec/plan; if important questions remain, ask the next one instead.

Before producing the final handoff, verify that `## Open Questions` contains no blocking user-preference decisions. If it does, ask the next single question instead of handing off. Do not mark a large/moderate workflow complete merely because you have a plausible recommendation; get confirmation for at least the highest-impact recommendation unless the original request already answered it.

When research is complete, stop and ask the user to choose the next step. Use natural prose and put only actual commands in code blocks. Do not wrap the whole handoff in one code block.

Include both:

- an immediate continuation option, such as “reply `continue`”; and
- a `/clear` resume option with the exact next command.

Route-specific handoff guidance:

- **trivial**: warn exactly, “This skips spec, plan, consensus, browser review, and workflow task tracking.” Offer direct execution only if all trivial markers are recorded and the user confirms. `/clear` command should be `/workflow-execute <workflow.research.md>`.
- **small**: explain spec and default consensus are skipped, plan is next, and browser review after plan is mandatory. `/clear` command should be `/workflow-plan <workflow-directory-or-workflow.toml>`.
- **moderate**: explain plan is next, consensus will be prompted after plan, and browser review after plan is mandatory. `/clear` command should be `/workflow-plan <workflow-directory-or-workflow.toml>`.
- **large**: explain spec is next, consensus is prompted after spec and plan, and browser review is mandatory after both. `/clear` command should be `/workflow-spec <workflow-directory-or-workflow.toml>`.
