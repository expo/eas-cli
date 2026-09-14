#!/usr/bin/env bash
# Builds the guard for the host (macOS) and runs the guard tests against it:
# white-box lock schedules with guard.c compiled in, and black-box cases with
# the built library inserted the way the simulator inserts it. No socket is
# ever opened to a non-loopback address.
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

clang -std=c11 -Wall -Wextra -Werror -O2 -dynamiclib policy.c guard.c -o "$out/egress-guard.dylib"
clang -std=c11 -Wall -Wextra -Werror -O2 -pthread policy.c tests/guard_test.c -o "$out/guard-test"
clang -std=c11 -Wall -Wextra -Werror -O2 tests/guard_insert_test.c -o "$out/guard-insert-test"

failures=0
report() {
  if [[ $2 -eq 0 ]]; then
    echo "ok   $1"
  else
    echo "FAIL $1 (exit $2)"
    failures=$((failures + 1))
  fi
}

# White-box: guard.c compiled into the test, lock schedules forced.
for name in signal fork contention; do
  status=0
  : > "$out/$name.log"
  EAS_EGRESS_GUARD_MODE=block EAS_EGRESS_GUARD_LOG="$out/$name.log" \
    "$out/guard-test" "$name" || status=$?
  report "$name" "$status"
done

# Black-box: the built library inserted into a plain process.
export DYLD_INSERT_LIBRARIES="$out/egress-guard.dylib"
export EAS_EGRESS_GUARD_MODE=block

status=0
: > "$out/fd-reuse.log"
EAS_EGRESS_GUARD_LOG="$out/fd-reuse.log" \
  "$out/guard-insert-test" fd-reuse "$out/fd-reuse.log" "$out/application-file" || status=$?
report fd-reuse "$status"

status=0
: > "$out/low-fd.log"
EAS_EGRESS_GUARD_LOG="$out/low-fd.log" \
  "$out/guard-insert-test" low-fd "$out/low-fd.log" 1>&- || status=$?
report low-fd "$status"

for name in nocancel unspec udp-disconnect callers overflow; do
  status=0
  : > "$out/$name.log"
  EAS_EGRESS_GUARD_LOG="$out/$name.log" \
    "$out/guard-insert-test" "$name" "$out/$name.log" || status=$?
  report "$name" "$status"
done

if [[ $failures -ne 0 ]]; then
  echo "egress-guard guard tests: $failures failure(s)"
  exit 1
fi
echo "egress-guard guard tests: all passed"
