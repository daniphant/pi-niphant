---
name: consensus
description: Ask multiple configured models to independently review a frozen plan, design, or decision and return agreement, disagreements, risks, and a recommendation. Use for explicit consensus requests, risky plans, architecture choices, security-sensitive changes, or post-implementation independent review. Do not use for ordinary code exploration.
---

# Consensus

Use the `run_consensus` tool when the user asks for consensus or asks multiple models/reviewers to evaluate a plan, design, implementation, or decision.

Consensus is for independent judgment over the same supplied context. It is not for having child models explore a repository.

Good uses:
- review an implementation plan before coding
- compare architecture tradeoffs
- identify migration risks
- review security-sensitive changes
- post-implementation sanity check

Bad uses:
- find files
- explore a repo
- summarize code structure
- replace direct reading by the primary model

Prefer passing the exact plan/context text in the prompt. Ask for a concise result with verdict, agreement, disagreements, blocking concerns, and recommended revision.
