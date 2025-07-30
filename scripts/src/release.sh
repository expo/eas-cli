#!/usr/bin/env bash

set -eo pipefail

GITHUB_USER=`git config get --global user.name`
GITHUB_EMAIL=`git config get --global user.email`

if [[ "$GITHUB_USER" != "Expo CI" || "$GITHUB_EMAIL" != "support+ci@expo.io" ]]; then
  echo "This script may only be executed by the Expo CI bot in a GitHub workflow."
  exit 1
fi

SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
ROOT_DIR="$( cd "$SCRIPTS_DIR"/.. && pwd )"

$SCRIPTS_DIR/bin/run update-local-plugin

next_version_bump=$($SCRIPTS_DIR/bin/run next-version)
next_version=${1:-$next_version_bump}

lerna version --exact "$next_version"
