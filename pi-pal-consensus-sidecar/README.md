# pi-pal-consensus-sidecar

Local HTTP/SSE dashboard sidecar that drives [PAL MCP](https://github.com/BeehiveInnovations/pal-mcp-server) consensus reviews.

It gives Pi a browser dashboard for plan-file consensus reviews without replacing PAL's provider/model routing.

## What it does

- starts a local HTTP server
- serves a dashboard at `http://127.0.0.1:<port>`
- accepts a markdown plan file plus reviewer roles
- launches PAL MCP as a stdio subprocess using the MCP SDK
- calls PAL's `consensus` tool step-by-step
- streams reviewer status over SSE
- writes raw per-reviewer artifacts and `findings.json`

## Install

From this monorepo:

```bash
npm install
npm run check --workspace pi-pal-consensus-sidecar
```

Symlink/install extensions with the repo install script, then `/reload` in Pi.

## Usage

In Pi:

```text
/pal-sidecar
```

Or use the tool:

```ts
start_pal_consensus_sidecar({ port: 8787 })
```

Then open the returned dashboard URL.

## PAL configuration

By default the sidecar launches PAL with:

```bash
uvx --from git+https://github.com/BeehiveInnovations/pal-mcp-server.git pal-mcp-server
```

Configure via env if needed:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export PAL_MCP_COMMAND=uvx
export PAL_MCP_ARGS="--from git+https://github.com/BeehiveInnovations/pal-mcp-server.git pal-mcp-server"
```

Artifacts are written to `.pi/pal-consensus-runs/<run-id>/` by default.
