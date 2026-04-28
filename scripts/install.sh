#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_PI=0
INSTALL_DROID=0
INSTALL_ALL=0
UNINSTALL=0
EXPLICIT_TARGET=0
PI_ARGS=()
DROID_ARGS=()
SELECTED=()

usage() {
  cat <<'EOF'
Usage:
  scripts/install.sh [options] [package...]

Options:
  --pi                  Install only Pi packages.
  --droid               Install only Droid plugins.
  --all                 Install all Pi packages and all Droid plugins.
  --delegated-agents    Include pi-delegated-agents with the default Pi set.
  --uninstall           Remove symlinks/plugins instead of installing.
  PI_BIN_DIR=dir        Override ni launcher install dir (default ~/.local/bin).
  DROID_SCOPE=scope     Droid install scope: user or project (default user).
  -h, --help            Show help.

Examples:
  scripts/install.sh
  scripts/install.sh --pi
  scripts/install.sh --droid
  scripts/install.sh --all
  scripts/install.sh pi-workflow droid-discord-presence
  scripts/install.sh --uninstall
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pi)
      INSTALL_PI=1
      EXPLICIT_TARGET=1
      shift
      ;;
    --droid)
      INSTALL_DROID=1
      EXPLICIT_TARGET=1
      shift
      ;;
    --all)
      INSTALL_ALL=1
      PI_ARGS+=(--all)
      shift
      ;;
    --delegated-agents)
      PI_ARGS+=(--delegated-agents)
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      PI_ARGS+=(--uninstall)
      DROID_ARGS+=(--uninstall)
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

if [[ "$INSTALL_ALL" == "1" ]]; then
  INSTALL_PI=1
  INSTALL_DROID=1
fi

if [[ ${#SELECTED[@]} -gt 0 ]]; then
  for pkg in "${SELECTED[@]}"; do
    case "$pkg" in
      pi-*)
        PI_ARGS+=("$pkg")
        INSTALL_PI=1
        ;;
      droid-*)
        DROID_ARGS+=("$pkg")
        INSTALL_DROID=1
        ;;
      *)
        echo "Unknown package namespace: $pkg (expected pi-* or droid-*)" >&2
        exit 1
        ;;
    esac
  done
fi

if [[ ${#SELECTED[@]} -eq 0 && "$EXPLICIT_TARGET" == "0" && "$INSTALL_ALL" == "0" ]]; then
  INSTALL_PI=1
  INSTALL_DROID=1
fi

if [[ "$INSTALL_PI" == "1" ]]; then
  if [[ ${#PI_ARGS[@]} -gt 0 ]]; then
    "$ROOT/scripts/install-pi.sh" "${PI_ARGS[@]}"
  else
    "$ROOT/scripts/install-pi.sh"
  fi
fi

if [[ "$INSTALL_DROID" == "1" ]]; then
  if [[ ${#DROID_ARGS[@]} -gt 0 ]]; then
    "$ROOT/scripts/install-droid.sh" "${DROID_ARGS[@]}"
  else
    "$ROOT/scripts/install-droid.sh"
  fi
fi
