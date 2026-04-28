#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKETPLACE_NAME="pi-niphant"
SCOPE="${DROID_SCOPE:-user}"
UNINSTALL=0
SELECTED=()

DEFAULT_PLUGINS=(
  droid-catppuccin-ui
  droid-discord-presence
)

usage() {
  cat <<'EOF'
Usage:
  scripts/install-droid.sh [options] [plugin...]

Options:
  --uninstall           Uninstall selected Droid plugins.
  DROID_SCOPE=scope     Install scope: user or project (default user).
  -h, --help            Show help.

Examples:
  scripts/install-droid.sh
  scripts/install-droid.sh droid-discord-presence
  scripts/install-droid.sh --uninstall
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      SELECTED+=("$1")
      shift
      ;;
  esac
done

if [[ "$SCOPE" != "user" && "$SCOPE" != "project" ]]; then
  echo "DROID_SCOPE must be user or project (got: $SCOPE)" >&2
  exit 1
fi

if ! command -v droid >/dev/null 2>&1; then
  if [[ "$UNINSTALL" == "1" ]]; then
    echo "Droid CLI not found on PATH; skipping Droid plugin uninstall." >&2
  else
    echo "Droid CLI not found on PATH; skipping Droid plugin install." >&2
  fi
  echo "Install Droid or run this later: droid plugin marketplace add '$ROOT'" >&2
  exit 0
fi

if [[ ${#SELECTED[@]} -gt 0 ]]; then
  PLUGINS=("${SELECTED[@]}")
else
  PLUGINS=("${DEFAULT_PLUGINS[@]}")
fi

for plugin in "${PLUGINS[@]}"; do
  if [[ ! -d "$ROOT/droid/$plugin/.factory-plugin" ]]; then
    echo "Unknown Droid plugin: $plugin" >&2
    exit 1
  fi
done

if [[ "$UNINSTALL" == "1" ]]; then
  for plugin in "${PLUGINS[@]}"; do
    droid plugin uninstall "$plugin@$MARKETPLACE_NAME" --scope "$SCOPE" || true
  done
  echo "Done. Removed selected Droid plugins from $SCOPE scope."
  exit 0
fi

droid plugin marketplace add "$ROOT" || droid plugin marketplace update "$MARKETPLACE_NAME" || true

for plugin in "${PLUGINS[@]}"; do
  droid plugin install "$plugin@$MARKETPLACE_NAME" --scope "$SCOPE"
done

echo "Done. Installed selected Droid plugins to $SCOPE scope. Restart Droid or run /plugins to verify."
