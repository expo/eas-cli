#!/usr/bin/env bash

set -eo pipefail

GITHUB_USER=`git config get --global user.name`
GITHUB_EMAIL=`git config get --global user.email`

SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
ROOT_DIR="$( cd "$SCRIPTS_DIR"/.. && pwd )"

# Since https://github.com/expo/eas-cli/pull/3237 , the local plugin version is identical
# to @expo/eas-build-job dependency, so the update-local-plugin step is no longer needed.
# $SCRIPTS_DIR/bin/run update-local-plugin

next_version_bump=`(cd $SCRIPTS_DIR; node --no-warnings=ExperimentalWarning --loader ts-node/esm src/nextVersion.ts)`
next_version=${1:-$next_version_bump}

echo "next_version = ${next_version}"

if [[ "$GITHUB_USER" == "Expo CI" && "$GITHUB_EMAIL" == "support+ci@expo.io" && "$INPUT_DRY_RUN" != "true" ]]; then
  echo "Releasing with version $next_version"
  lerna version --yes --exact "$next_version"
else
  echo "We are running with a normal GitHub user, or the dry run flag is enabled, so run the script in dry run mode, without committing or pushing any changes."
  lerna version --yes --exact "$next_version" --no-push --no-git-tag-version
fi
