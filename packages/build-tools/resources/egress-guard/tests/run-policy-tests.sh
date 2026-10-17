#!/usr/bin/env bash
# Builds the policy unit tests for the host (macOS) and runs them.
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(mktemp -d)
clang -std=c11 -Wall -Wextra -Werror -o "$out/policy_test" policy.c tests/policy_test.c
"$out/policy_test"
