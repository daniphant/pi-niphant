#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
SKILL_DIR="${PI_SKILLS_DIR:-$HOME/.pi/agent/skills}"
BIN_DIR="${PI_BIN_DIR:-$HOME/.local/bin}"
UNINSTALL=0
INSTALL_ALL=0
INSTALL_DELEGATED=0
SELECTED=()

DEFAULT_PACKAGES=(
  pi-clear
  pi-checkpoint
  pi-catppuccin-ui
  pi-codex-compaction
  pi-codex-like-diff
  pi-consensus
  pi-delegation-guard
  pi-diagnostics
  pi-markdown-commands
  pi-web-e2e-agent
  pi-workflow
  pi-agent-notify
  pi-hud
  pi-whimsy-status
  pi-github-repo-explorer
)

ALL_PACKAGES=(
  "${DEFAULT_PACKAGES[@]}"
  pi-delegated-agents
)

usage() {
  cat <<'EOF'
Usage:
  scripts/install.sh [options] [package...]

Options:
  --all                 Install every package, including pi-delegated-agents.
  --delegated-agents    Include pi-delegated-agents with the default set.
  --uninstall           Remove symlinks instead of installing.
  PI_BIN_DIR=dir        Override ni launcher install dir (default ~/.local/bin).
  -h, --help            Show help.

Examples:
  scripts/install.sh
  scripts/install.sh --all
  scripts/install.sh pi-workflow pi-consensus pi-diagnostics
  scripts/install.sh --uninstall
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      INSTALL_ALL=1
      shift
      ;;
    --delegated-agents)
      INSTALL_DELEGATED=1
      shift
      ;;
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

if [[ ${#SELECTED[@]} -gt 0 ]]; then
  PACKAGES=("${SELECTED[@]}")
elif [[ "$INSTALL_ALL" == "1" ]]; then
  PACKAGES=("${ALL_PACKAGES[@]}")
else
  PACKAGES=("${DEFAULT_PACKAGES[@]}")
  if [[ "$INSTALL_DELEGATED" == "1" ]]; then
    PACKAGES+=(pi-delegated-agents)
  fi
fi

mkdir -p "$EXT_DIR" "$SKILL_DIR" "$BIN_DIR"

link_ext() {
  local name="$1"
  local target="$2"
  if [[ "$UNINSTALL" == "1" ]]; then
    rm -f "$EXT_DIR/$name"
    echo "removed extension $name"
  else
    ln -sfn "$target" "$EXT_DIR/$name"
    echo "installed extension $name -> $target"
  fi
}

link_skill() {
  local name="$1"
  local target="$2"
  if [[ "$UNINSTALL" == "1" ]]; then
    rm -f "$SKILL_DIR/$name"
    echo "removed skill $name"
  else
    ln -sfn "$target" "$SKILL_DIR/$name"
    echo "installed skill $name -> $target"
  fi
}

install_package() {
  local pkg="$1"
  case "$pkg" in
    pi-agent-notify)
      link_ext pi-agent-notify "$ROOT/pi-agent-notify"
      ;;
    pi-checkpoint)
      link_ext pi-checkpoint "$ROOT/pi-checkpoint"
      ;;
    pi-catppuccin-ui)
      link_ext pi-catppuccin-ui "$ROOT/pi-catppuccin-ui"
      ;;
    pi-clear)
      link_ext pi-clear "$ROOT/pi-clear"
      ;;
    pi-codex-compaction)
      link_ext pi-codex-compaction "$ROOT/pi-codex-compaction"
      ;;
    pi-codex-like-diff)
      link_ext pi-codex-like-diff "$ROOT/pi-codex-like-diff"
      ;;
    pi-consensus)
      link_ext pi-consensus "$ROOT/pi-consensus"
      link_skill consensus "$ROOT/pi-consensus/skills/consensus"
      ;;
    pi-delegated-agents)
      link_ext pi-delegated-agents "$ROOT/pi-delegated-agents/extensions/pi-delegated-agents"
      link_skill spawn-agent "$ROOT/pi-delegated-agents/skills/spawn-agent"
      ;;
    pi-delegation-guard)
      link_ext pi-delegation-guard "$ROOT/pi-delegation-guard"
      ;;
    pi-diagnostics)
      link_ext pi-diagnostics "$ROOT/pi-diagnostics"
      link_skill systematic-debugging "$ROOT/pi-diagnostics/skills/systematic-debugging"
      ;;
    pi-github-repo-explorer)
      link_skill explore-github-repo "$ROOT/pi-github-repo-explorer/skills/explore-github-repo"
      ;;
    pi-hud)
      link_ext pi-hud "$ROOT/pi-hud/extensions/pi-hud"
      ;;
    pi-markdown-commands)
      link_ext pi-markdown-commands "$ROOT/pi-markdown-commands"
      ;;
    pi-web-e2e-agent)
      link_ext pi-web-e2e-agent "$ROOT/pi-web-e2e-agent"
      link_skill e2e-web-agent "$ROOT/pi-web-e2e-agent/skills/e2e-web-agent"
      ;;
    pi-whimsy-status)
      link_ext pi-whimsy-status "$ROOT/pi-whimsy-status/extensions/pi-whimsy-status"
      ;;
    pi-workflow)
      link_ext pi-workflow "$ROOT/pi-workflow"
      link_skill research-plan-implement "$ROOT/pi-workflow/skills/research-plan-implement"
      link_skill workflow-brainstorm "$ROOT/pi-workflow/skills/workflow-brainstorm"
      link_skill workflow-spec "$ROOT/pi-workflow/skills/workflow-spec"
      link_skill workflow-plan "$ROOT/pi-workflow/skills/workflow-plan"
      link_skill workflow-implement "$ROOT/pi-workflow/skills/workflow-implement"
      ;;
    *)
      echo "Unknown package: $pkg" >&2
      return 1
      ;;
  esac
}

for pkg in "${PACKAGES[@]}"; do
  install_package "$pkg"
done

install_ni=0
for pkg in "${PACKAGES[@]}"; do
  if [[ "$pkg" == "pi-workflow" ]]; then install_ni=1; fi
done

if [[ "$install_ni" == "1" ]]; then
  if [[ "$UNINSTALL" == "1" ]]; then
    if [[ -L "$BIN_DIR/ni" && "$(readlink "$BIN_DIR/ni")" == "$ROOT/scripts/ni" ]]; then
      rm -f "$BIN_DIR/ni"
      echo "removed launcher ni"
    else
      echo "left launcher ni untouched (not an owned symlink)"
    fi
  else
    ln -sfn "$ROOT/scripts/ni" "$BIN_DIR/ni"
    echo "installed launcher ni -> $ROOT/scripts/ni"
  fi
fi

if [[ "$UNINSTALL" == "1" ]]; then
  echo "Done. Removed selected Pi symlinks."
else
  echo "Done. Run /reload inside Pi. Ensure $BIN_DIR is on PATH, then use: ni"
fi
