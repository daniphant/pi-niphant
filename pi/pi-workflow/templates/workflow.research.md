# Research: {{title}}

- **Workflow ID:** `{{id}}`
- **Created:** {{createdAt}}
- **Source Request:** {{request}}

---

## Problem / Opportunity

## Motivation / Why Now

## User Goals

## Non-Goals

## Open Questions

## Decisions Made

## Alternatives Considered

## Current System Research

### Reference Implementations

### Relevant Files / Symbols

### Constraints / User Preferences

### Risks / Unknowns

## Complexity / Route Recommendation

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

### Route Decision Notes

- Non-trivial workflows must use `Execution source: plan` and `Workflow task tracking: enabled`.
- Trivial workflows may use `Execution source: research` only when all skip markers are explicit and the user has confirmed direct execution.
- If the route is not obvious, choose the safer route and explain the tradeoff here.
