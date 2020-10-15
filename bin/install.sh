#!/bin/bash

# This script downloads the latest release version of EAS CLI from GitHub and
# installs it in /usr/local/bin

{
  # All code is inside a block to ensure the script executes only when
  # downloaded completely.

  set -e
  
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

  if [[ ! ":$PATH:" == *":/usr/local/bin:"* ]]; then
    abort "Your path is missing /usr/local/bin, you need to add this to use this installer."
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
      abort "This installer is only supported on macOS, Linux and Windows Subsystem for Linux."
      ;;
  esac

  url="https://github.com/expo/eas-cli/releases/latest/download/eas-$platform-$arch.tar.gz"
  echo "Installing EAS CLI from $url"

  mkdir -p /usr/local/lib
  cd /usr/local/lib
  rm -rf eas
  
  echo
  echo "Downloading..."
  if [ "$(command -v curl)" ]
  then
    curl --location --progress-bar "$url" | tar xz
  else
    wget -O- "$url" | tar xz
  fi

  rm -f "$(command -v eas)" || true
  rm -f /usr/local/bin/eas
  ln -s /usr/local/lib/eas/bin/eas /usr/local/bin/eas

  # Test the bundled node binary and if it doesn't work remove it (fall back to
  # node installed in path).
  /usr/local/lib/eas/bin/node -v > /dev/null || {
    rm /usr/local/lib/eas/bin/node
  }

  # Test the CLI
  executable=$(command -v eas)
  echo
  echo -e "EAS CLI installed to ${executable}"
  eas --version

  echo
  echo -e "Type ${text_bold}eas --help${text_normal} to get started."
}