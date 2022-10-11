#!/usr/bin/env bash

set -eo pipefail

SCRIPTS_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/.. && pwd )"
ROOT_DIR="$( cd "$SCRIPTS_DIR"/.. && pwd )"

$SCRIPTS_DIR/bin/run update-local-plugin

next_version_bump=$($SCRIPTS_DIR/bin/run next-version)
next_version=${1:-$next_version_bump}

lerna version --exact "$next_version"
