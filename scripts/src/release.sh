#!/usr/bin/env bash

set -eo pipefail

GITHUB_USER=`git config get --global user.name`
GITHUB_EMAIL=`git config get --global user.email`

SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
ROOT_DIR="$( cd "$SCRIPTS_DIR"/.. && pwd )"

$SCRIPTS_DIR/bin/run update-local-plugin

next_version_bump=$($SCRIPTS_DIR/bin/run next-version)
next_version=${1:-$next_version_bump}

if [[ "$GITHUB_USER" == "Expo CI" && "$GITHUB_EMAIL" == "support+ci@expo.io" ]]; then
  echo "Releasing with version $next_version"
  lerna version --yes --exact "$next_version"
else
  echo "We are running with a normal GitHub user, so run the script in dry run mode, without committing or pushing any changes."
  lerna version --yes --exact "$next_version" --no-push --no-git-tag-version
fi
