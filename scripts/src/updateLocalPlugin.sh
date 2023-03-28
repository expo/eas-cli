#!/usr/bin/env bash

set -eo pipefail

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/../.. && pwd )"
LOCAL_TS_PATH="$ROOT_DIR/packages/eas-cli/src/build/local.ts"

LOCAL_BUILD_PLUGIN_NPM_TAG="eas-cli"

echo "Checking if eas-cli-local-build-plugin upgrade is available"

plugin_version_latest=$(npm info eas-cli-local-build-plugin@$LOCAL_BUILD_PLUGIN_NPM_TAG version)
plugin_version_current=$(grep 'const PLUGIN_PACKAGE_VERSION' $LOCAL_TS_PATH | cut -d"'" -f2)

if [[ "$plugin_version_latest" == "$plugin_version_current" ]]; then
  echo "eas-cli-local-build-plugin is already on the latest version - $plugin_version_latest"
else
  echo "Bumping eas-cli-local-build-plugin from $plugin_version_current to $plugin_version_latest"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/$plugin_version_current/$plugin_version_latest/g" $LOCAL_TS_PATH
  else
    sed -i "s/$plugin_version_current/$plugin_version_latest/g" $LOCAL_TS_PATH
  fi
  git add $LOCAL_TS_PATH
  git commit -m "upgrade eas-cli-local-build-plugin to $plugin_version_latest"
fi
