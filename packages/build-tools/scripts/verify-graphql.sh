#!/usr/bin/env bash

set -eox pipefail

# Generated GraphQL files are untracked, so always regenerate and check compatibility.
yarn gql
yarn run -T lerna run build --scope @expo/build-tools --include-dependencies
