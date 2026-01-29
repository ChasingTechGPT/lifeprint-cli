#!/bin/bash
set -euo pipefail

# LifePrint CLI Installer
# Usage: curl -fsSL https://lifeprintpro.com/cli/install.sh | bash

VERSION="${LIFEPRINT_VERSION:-latest}"
GITHUB_REPO="ChasingTechGPT/lifeprint-cli"
INSTALL_DIR="/usr/local/bin"
FALLBACK_DIR="$HOME/.lifeprint/bin"
BINARY_NAME="lifeprint"

# ─── Colors ───────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { printf "${CYAN}info${NC}  %s\n" "$1"; }
success() { printf "${GREEN}✓${NC}     %s\n" "$1"; }
warn()    { printf "${YELLOW}warn${NC}  %s\n" "$1"; }
error()   { printf "${RED}error${NC} %s\n" "$1" >&2; exit 1; }

# ─── Detect Platform ─────────────────────────────────────────────
detect_platform() {
  local os arch

  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="macos" ;;
    Linux)  os="linux" ;;
    *)      error "Unsupported operating system: $os" ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *)             error "Unsupported architecture: $arch" ;;
  esac

  # Linux only has x64 build
  if [ "$os" = "linux" ]; then
    BINARY="lifeprint-linux"
  else
    BINARY="lifeprint-${os}-${arch}"
  fi

  info "Detected platform: ${os} (${arch})"
}

# ─── Resolve Download URL ────────────────────────────────────────
resolve_url() {
  if [ "$VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/${BINARY}"
  else
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/${BINARY}"
  fi
}

# ─── Choose Install Directory ────────────────────────────────────
choose_install_dir() {
  if [ -w "$INSTALL_DIR" ]; then
    TARGET_DIR="$INSTALL_DIR"
  elif command -v sudo &>/dev/null; then
    info "Requires sudo to install to ${INSTALL_DIR}"
    USE_SUDO=true
    TARGET_DIR="$INSTALL_DIR"
  else
    warn "Cannot write to ${INSTALL_DIR}, installing to ${FALLBACK_DIR}"
    TARGET_DIR="$FALLBACK_DIR"
    mkdir -p "$TARGET_DIR"
  fi
}

# ─── Download Binary ─────────────────────────────────────────────
download() {
  local tmp_file
  tmp_file="$(mktemp)"

  info "Downloading LifePrint CLI..."
  info "  ${DOWNLOAD_URL}"

  if command -v curl &>/dev/null; then
    curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$tmp_file" || error "Download failed. Check your internet connection or the release URL."
  elif command -v wget &>/dev/null; then
    wget -q --show-progress "$DOWNLOAD_URL" -O "$tmp_file" || error "Download failed. Check your internet connection or the release URL."
  else
    error "Neither curl nor wget found. Please install one and retry."
  fi

  echo "$tmp_file"
}

# ─── Install ─────────────────────────────────────────────────────
install_binary() {
  local tmp_file="$1"
  local target="${TARGET_DIR}/${BINARY_NAME}"

  if [ "${USE_SUDO:-false}" = "true" ]; then
    sudo mv "$tmp_file" "$target"
    sudo chmod +x "$target"
  else
    mv "$tmp_file" "$target"
    chmod +x "$target"
  fi

  success "Installed to ${target}"
}

# ─── Update PATH ─────────────────────────────────────────────────
ensure_path() {
  if [ "$TARGET_DIR" = "$FALLBACK_DIR" ]; then
    # Check if already in PATH
    if [[ ":$PATH:" != *":${FALLBACK_DIR}:"* ]]; then
      local shell_config=""
      if [ -f "$HOME/.zshrc" ]; then
        shell_config="$HOME/.zshrc"
      elif [ -f "$HOME/.bashrc" ]; then
        shell_config="$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        shell_config="$HOME/.bash_profile"
      fi

      if [ -n "$shell_config" ]; then
        echo "" >> "$shell_config"
        echo "# LifePrint CLI" >> "$shell_config"
        echo "export PATH=\"${FALLBACK_DIR}:\$PATH\"" >> "$shell_config"
        info "Added ${FALLBACK_DIR} to PATH in ${shell_config}"
        warn "Run 'source ${shell_config}' or open a new terminal to use lifeprint"
      else
        warn "Add the following to your shell config:"
        echo "  export PATH=\"${FALLBACK_DIR}:\$PATH\""
      fi
    fi
  fi
}

# ─── Verify Installation ─────────────────────────────────────────
verify() {
  if command -v lifeprint &>/dev/null; then
    local ver
    ver="$(lifeprint --version 2>/dev/null || echo "unknown")"
    success "LifePrint CLI ${ver} is ready"
  elif [ -x "${TARGET_DIR}/${BINARY_NAME}" ]; then
    success "Binary installed successfully"
    warn "You may need to open a new terminal for PATH changes to take effect"
  else
    error "Installation could not be verified"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────
main() {
  printf "\n${BOLD}  LifePrint CLI Installer${NC}\n\n"

  detect_platform
  resolve_url
  choose_install_dir

  local tmp_file
  tmp_file="$(download)"

  install_binary "$tmp_file"
  ensure_path
  verify

  printf "\n${BOLD}  Get started:${NC}\n"
  printf "    ${CYAN}lifeprint login${NC}     Sign in to your account\n"
  printf "    ${CYAN}lifeprint agenda${NC}    View today's agenda\n"
  printf "    ${CYAN}lifeprint --help${NC}    See all commands\n\n"
}

main
