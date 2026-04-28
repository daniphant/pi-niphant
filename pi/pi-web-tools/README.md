# pi-web-tools

Direct web-reading tools for [Pi](https://github.com/mariozechner/pi-coding-agent):

- `web_open` fetches a public HTTP(S) URL without browser automation and returns Markdown, plain text, or raw HTML.
- `web_search` queries the Brave Search API and returns compact web results.

These tools are intentionally separate from [`pi-web-e2e-agent`](../pi-web-e2e-agent). Use `pi-web-tools` for direct HTTP reads/search. Use `pi-web-e2e-agent` when you need JavaScript rendering, clicks/forms, screenshots, sessions, snapshots, or other browser behavior.

## Install

From this repository:

```bash
./scripts/install.sh pi-web-tools
```

Then run `/reload` inside Pi.

## Configuration

### Brave Search

`web_search` requires a Brave Search API key. Configuration is resolved in this order:

1. process environment variable: `BRAVE_SEARCH_API_KEY`
2. user-local env file: `~/.pi/agent/extensions/pi-web-tools/.env`
3. package-local env file: `pi-web-tools/.env`

Examples:

```bash
export BRAVE_SEARCH_API_KEY='...'
```

or:

```env
# pi-web-tools/.env
BRAVE_SEARCH_API_KEY=...
```

Search queries are sent to Brave Search. Do not send sensitive queries unless that disclosure is acceptable. API keys are redacted from tool output and error paths.

### Private-network allowlist

`web_open` blocks private/local/link-local/metadata IP ranges by default, including localhost, RFC1918 networks, IPv6 local ranges, and IPv4-mapped IPv6 loopback/private forms.

A narrow private-network override is available for local development:

```bash
export PI_WEB_ALLOW_PRIVATE_NETWORK='localhost:8080,http://localhost:3000,127.0.0.1/32'
```

Allowlist syntax is intentionally limited and fail-closed:

- exact `host:port`
- exact URL origins with explicit ports, such as `http://localhost:8080`
- exact IPv4/CIDR entries when needed
- no wildcards, regexes, partial globs, or broad `*`
- bounded entry count

Enabling this can expose localhost or internal services to the agent. Keep entries as narrow as possible.

## `web_open`

Parameters:

- `url`: HTTP(S) URL.
- `format`: `markdown`, `text`, or `html`; defaults to `markdown`.
- `timeout`: milliseconds; capped at 20 seconds.

Security/safety behavior:

- only `http://` and `https://`
- credentialed URLs are rejected
- no custom headers, cookies, auth, request bodies, methods, proxy settings, redirect policy, or byte-limit overrides
- default public ports are 80 and 443
- manual redirect handling with per-hop URL/DNS/IP/port validation
- HTTPS-to-HTTP redirects are blocked
- private/local/link-local/metadata addresses are blocked unless exactly allowlisted
- DNS resolution validates all returned addresses; any private address blocks the request unless allowlisted
- custom Node `http`/`https` lookup pins the connection to a prevalidated address
- HTTPS keeps SNI/servername and Host based on the original URL with default certificate validation
- ambient `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` are ignored
- compressed and decompressed response sizes are capped
- unsupported binary responses are rejected
- output is framed as untrusted content and truncated to 50 KB / 2,000 lines

`web_open` reveals your request origin, timing, and User-Agent to target servers.

Limitations:

- no JavaScript rendering
- no login/session/cookie support
- no browser fallback
- extraction from JS-heavy or sparse pages may be limited

## `web_search`

Parameters:

- `query`: search query sent to Brave Search.
- `count`: defaults to 10, capped at 20.

Behavior:

- requires `BRAVE_SEARCH_API_KEY`
- sends only the Brave API request needed for the query
- maps normal results into a compact numbered list
- maps quota/rate-limit errors clearly and does not automatically retry
- redacts API-key-like secrets in output and error paths
- output is framed as untrusted content and truncated to 50 KB / 2,000 lines

## Development

```bash
npm --prefix pi-web-tools test
npm --prefix pi-web-tools run build
```

Tests use local servers and mocks; they do not require live Brave credentials or external internet.
