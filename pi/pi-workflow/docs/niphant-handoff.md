# Niphant handoff contract

Date: 2026-04-24

V1 uses an explicit handoff instead of attempting to mutate the active Pi session cwd.

Pi command handlers expose `ctx.cwd` and session helpers, but this repository does not currently have a documented, tested guarantee that replacing/forking a session from a command makes all subsequent tool calls, workflow-file lookup, and extension state resolve against a new worktree. To avoid stale-context bugs, `/workflow` in `NIPHANT=1` mode creates or resumes the niphant worktree, records metadata, and prints:

```sh
cd '<worktree>' && ni
```

Hard rule: until a future spike proves cwd-safe session replacement end-to-end, niphant workflow preflight must return immediately after printing the handoff and must not send `/skill:workflow-brainstorm` from the old checkout.

This deliberately satisfies V1 safety over magic: worktrees are created before implementation-oriented work, but the user explicitly continues from the selected checkout.
