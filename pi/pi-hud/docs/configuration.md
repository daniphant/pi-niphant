# Configuration

## Settings file

pi-hud persists settings to:

```txt
~/.pi/agent/extensions/pi-hud.json
```

Fields:

| Field | Type | Description | Default |
|---|---|---|---|
| `enabled` | boolean | Turns the HUD on or off globally. | `true` |
| `showWeeklyLimits` | boolean | Shows the secondary quota window, typically weekly usage, when available. | `false` |
| `quotaCache` | object | Auto-managed cached provider snapshots used for stale-while-refresh rendering after reloads. | `{}` |

Example:

```json
{
  "enabled": true,
  "showWeeklyLimits": false,
  "quotaCache": {
    "zai": {
      "providerKey": "zai",
      "fetchedAt": 1776053603881,
      "snapshot": {
        "kind": "zai",
        "plan": "glm-pro",
        "primary": {
          "label": "5h",
          "usedPercent": 1,
          "resetAt": 1776053603881
        },
        "secondary": {
          "label": "7d",
          "usedPercent": 2,
          "resetAt": 1776537076997
        }
      }
    }
  }
}
```

## Cache behavior

Quota snapshots use a 2 minute TTL.

Behavior:
- cached data is rendered immediately on reload
- a refresh happens in the background when data is stale
- z.ai snapshots missing reset timestamps are force-refreshed

## Environment variables

### z.ai

| Variable | Required | Description | Default |
|---|---|---|---|
| `Z_AI_QUOTA_URL` | No | Overrides the full quota endpoint URL used for z.ai usage requests. | Derived from `Z_AI_API_HOST`, otherwise `https://api.z.ai/api/monitor/usage/quota/limit` |
| `Z_AI_API_HOST` | No | Overrides the z.ai API host used to construct the quota endpoint. | `https://api.z.ai` |

## Auth sources

### Codex
`~/.codex/auth.json`

### z.ai / GLM
Resolved via Pi's model registry for the active model.
