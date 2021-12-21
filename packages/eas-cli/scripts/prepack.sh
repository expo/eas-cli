#!/usr/bin/env bash

set -eo pipefail

rm -rf build
yarn build

if [ -z "$CLI_SIZE_CHECK" ]; then
  yarn oclif manifest
fi
