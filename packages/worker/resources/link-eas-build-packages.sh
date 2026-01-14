#!/usr/bin/env bash

# Links/unlinks local eas-build packages for development.
#
# Prerequisites:
#   Run `yarn link` in each package directory in eas-build repo first:
#     cd /path/to/eas-build
#     for pkg in build-tools steps eas-build-job downloader logger template-file turtle-spawn; do
#       (cd packages/$pkg && yarn link)
#     done
#
# Usage:
#   ./resources/link-eas-build-packages.sh          # Link all packages
#   ./resources/link-eas-build-packages.sh --unlink # Unlink and restore npm versions

set -e

PACKAGES=(
  "@expo/build-tools"
  "@expo/steps"
  "@expo/eas-build-job"
  "@expo/downloader"
  "@expo/logger"
  "@expo/template-file"
  "@expo/turtle-spawn"
)

if [[ "$1" == "--unlink" ]]; then
  CMD="unlink"
  echo "Unlinking eas-build packages..."
else
  CMD="link"
  echo "Linking eas-build packages..."
fi

for PACKAGE in "${PACKAGES[@]}"; do
  echo "yarn $CMD $PACKAGE"
  yarn $CMD "$PACKAGE"
done

if [[ "$1" == "--unlink" ]]; then
  echo ""
  echo "Restoring npm versions..."
  yarn install --force
fi

echo ""
echo "Done!"
