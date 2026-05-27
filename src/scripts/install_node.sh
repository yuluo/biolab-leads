#!/usr/bin/env bash
# Idempotent Node.js installer.
# Ensures `node` (>=20) and `npm` are on PATH. Returns 0 if usable Node is
# already present or successfully installed; non-zero on failure.
#
# Strategy:
#   macOS  -> Homebrew (`brew install node@20`); if brew missing, install brew first
#   Linux  -> nvm (~/.nvm) + `nvm install 20`
#   Win/*  -> print manual instructions, exit 1
#
# Output is plain text suitable for streaming to a terminal.

set -u

REQUIRED_MAJOR=20

log()  { printf '[install_node] %s\n' "$*"; }
warn() { printf '[install_node][warn] %s\n' "$*" >&2; }
die()  { printf '[install_node][error] %s\n' "$*" >&2; exit 1; }

current_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/'
}

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then return 0; fi
  log "Homebrew not found. Installing Homebrew (will prompt for sudo password)."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || die "Homebrew install failed."
  # Add brew to PATH for current shell
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_macos() {
  ensure_brew
  log "Installing node@${REQUIRED_MAJOR} via Homebrew."
  brew install "node@${REQUIRED_MAJOR}" || die "brew install node@${REQUIRED_MAJOR} failed."
  brew link --overwrite --force "node@${REQUIRED_MAJOR}" 2>/dev/null || true
}

install_linux() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    log "Installing nvm into $NVM_DIR."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
      || die "nvm install failed."
  fi
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  log "Installing Node ${REQUIRED_MAJOR} via nvm."
  nvm install "$REQUIRED_MAJOR" || die "nvm install $REQUIRED_MAJOR failed."
  nvm alias default "$REQUIRED_MAJOR" >/dev/null 2>&1 || true
}

main() {
  have=$(current_major)
  if [ "$have" -ge "$REQUIRED_MAJOR" ] 2>/dev/null; then
    log "Node $(node -v) already installed — skipping."
    exit 0
  fi
  if [ "$have" -gt 0 ]; then
    log "Found Node v${have}, need >=${REQUIRED_MAJOR}. Upgrading."
  else
    log "Node not found. Installing."
  fi

  os=$(uname -s)
  case "$os" in
    Darwin) install_macos ;;
    Linux)  install_linux ;;
    *)      die "Unsupported OS: $os. Install Node ${REQUIRED_MAJOR}+ manually from https://nodejs.org/." ;;
  esac

  command -v node >/dev/null 2>&1 || die "Node still not on PATH after install. Open a new terminal and re-run."
  log "Node ready: $(node -v), npm $(npm -v)"
}

main "$@"
