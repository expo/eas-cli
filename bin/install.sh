#!/bin/bash

# This script downloads the latest release version of EAS CLI from GitHub and
# installs it in /usr/local/bin

{
  # All code is inside a block to ensure the script executes only when
  # downloaded completely.

  set -e

  prefix="${EAS_PREFIX:-/usr/local}"
  temp_dir="$(mktemp -d)"
  
  if  [ -t 1 ] && [ -z "$NO_COLOR" ]
  then
    # Use colors when stdout is a terminal and NO_COLOR isn't set.
    text_bold=$'\033[1m'
    text_normal=$'\033[22m'
    text_red=$'\033[31m'
    text_default_color=$'\033[39m'
  else
    # Disable colors
    text_bold=""
    text_normal=""
    text_red=""
    text_default_color=""
  fi

  abort() {
    echo -e "$text_bold$text_red$1$text_normal$text_default_color"
    exit 1
  }

  install() {
    needs_sudo=""
    # Make sure path exists and can be written to by the current user.
    if ! mkdir -p "$prefix/lib" || [[ ! -w "$prefix/lib" ]]
    then
      needs_sudo=true
    fi
    if ! mkdir -p "$prefix/bin" || [[ ! -w "$prefix/bin" ]]
    then
      needs_sudo=true
    fi
    if ! rm -rf "$prefix/lib/eas"
    then
      needs_sudo=true
    fi
    # Run commands with sudo if necessary.
    if [ -n "$needs_sudo" ]
    then
      if [ "$EUID" -ne 0 ]
      then
        echo "Installing requires superuser access."
        echo "The sudo command will prompt for your password."
      fi
      sudo rm -rf "$prefix/lib/eas"
      sudo mv "$temp_dir/eas" "$prefix/lib/eas"
      sudo ln -fs "$prefix/lib/eas/bin/eas" "$prefix/bin/eas"
    else
      mv "$temp_dir/eas" "$prefix/lib/eas"
      ln -fs "$prefix/lib/eas/bin/eas" "$prefix/bin/eas"
    fi
  }

  if [[ ! ":$PATH:" == *":$prefix/bin:"* ]]; then
    abort "Your path is missing $prefix/bin, you need to add this to \$PATH use this installer."
  fi
  
  hardware="$(uname -m)"
  case "$hardware" in
    x86_64)
      arch="x64"
      ;;
    arm*)
      arch="arm"
      ;;
    *)
      abort "Unsupported CPU architecture $hardware."
      ;;
  esac

  case "$(uname -s)" in
    Darwin*)
      platform="darwin"
      if [[ "$arch" != "x64" ]]; then
        abort "Unsupported CPU architecture $hardware on macOS."
      fi
      ;;
    Linux*)
      platform="linux"
      ;;
    *)
      abort "This installer is supported only on macOS, Linux, and Windows Subsystem for Linux."
      ;;
  esac

  url="https://github.com/expo/eas-cli/releases/latest/download/eas-$platform-$arch.tar.gz"
  echo "Installing EAS CLI from $url"

  mkdir -p "$temp_dir"
  cd "$temp_dir"
  
  echo
  echo "Downloading..."
  if [ "$(command -v curl)" ]
  then
    curl --location --progress-bar "$url" | tar xz
  else
    wget -O- "$url" | tar xz
  fi

  # Move the installation over and link the executable (may require sudo)
  install

  # Test the bundled node binary and if it doesn't work remove it (fall back to
  # node installed in path).
  "$prefix/lib/eas/bin/node" -v > /dev/null || {
    rm "$prefix/lib/eas/bin/node"
  }

  # Test the CLI
  executable=$(command -v eas) || abort "Could not run eas after installation."
  echo
  echo -e "EAS CLI is installed to ${executable}"
  eas --version

  echo
  echo -e "Type ${text_bold}eas --help${text_normal} to get started."
}
