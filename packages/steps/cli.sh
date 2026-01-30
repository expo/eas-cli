#!/usr/bin/env bash

set -eo pipefail

STEPS_ROOT_DIR=$( dirname "${BASH_SOURCE[0]}" )

node $STEPS_ROOT_DIR/dist/cli/cli.js $@ | yarn run bunyan -o short
