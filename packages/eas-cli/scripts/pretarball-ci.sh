#!/usr/bin/env bash

set -eo pipefail

EAS_CLI_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
PACKAGE_JSON_PATH="$EAS_CLI_DIR/package.json"

# Define local packages and their directory names
# Only include packages that both exist in packages/ and are dependencies of the packages we care about
# We start with direct dependencies of eas-cli and their own local dependencies
PACKAGES=(
  "@expo/eas-json:eas-json"
  "@expo/eas-build-job:eas-build-job"
  "@expo/logger:logger"
  "@expo/steps:steps"
)

# Function to rewrite dependencies in a package.json file
rewrite_deps() {
  local PKG_JSON=$1
  local IS_EAS_CLI=$2

  for package in "${PACKAGES[@]}" ; do
    KEY="${package%%:*}"
    DIR="${package##*:}"

    # Determine the relative path. If IS_EAS_CLI we go one level deeper because oclif builds in `tmp` in current directory.
    if [[ "$IS_EAS_CLI" == "true" ]]; then
      REL_PATH="file:../../../$DIR"
    else
      REL_PATH="file:../$DIR"
    fi

    # Replace version with relative path
    # Using # delimiter for sed to handle slashes
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s#\"$KEY\": \".*\"#\"$KEY\": \"$REL_PATH\"#g" "$PKG_JSON"
    else
      sed -i "s#\"$KEY\": \".*\"#\"$KEY\": \"$REL_PATH\"#g" "$PKG_JSON"
    fi
  done
}

# Update eas-cli/package.json
echo "Updating eas-cli/package.json"
rewrite_deps "$PACKAGE_JSON_PATH" "true"

# Update other relevant local packages
# We iterate the PACKAGES list itself to find their locations and update them
# This ensures we only touch packages that are part of the dependency graph we care about
WORKSPACE_ROOT="$(cd "$EAS_CLI_DIR/.." && pwd)"

for package in "${PACKAGES[@]}" ; do
  DIR="${package##*:}"
  PKG_JSON="$WORKSPACE_ROOT/$DIR/package.json"

  if [[ -f "$PKG_JSON" ]]; then
    echo "Updating $DIR/package.json"
    rewrite_deps "$PKG_JSON" "false"
  fi
done
