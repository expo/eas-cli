#!/usr/bin/env bash
# Builds the guard as a universal (arm64 + x86_64) iOS Simulator dylib into
# packages/build-tools/bin/egress-guard.dylib. Requires Xcode.
set -euo pipefail
cd "$(dirname "$0")"
# Output directory; defaults to packages/build-tools/bin.
bin_dir="${1:-../../bin}"
mkdir -p "$bin_dir"
out=$(mktemp -d)
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
for arch in arm64 x86_64; do
  xcrun --sdk iphonesimulator clang \
    -std=c11 -Wall -Wextra -Werror -O2 \
    -target "$arch-apple-ios15.0-simulator" -isysroot "$sdk" \
    -dynamiclib -install_name @rpath/egress-guard.dylib \
    -o "$out/egress-guard-$arch.dylib" policy.c guard.c
done
lipo -create -output "$bin_dir/egress-guard.dylib" "$out/egress-guard-arm64.dylib" "$out/egress-guard-x86_64.dylib"
lipo -info "$bin_dir/egress-guard.dylib"
