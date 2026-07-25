#!/usr/bin/env bash

set -eo pipefail
set -x

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )"/../.. && pwd )"
WORKER_DIR=$( dirname "${BASH_SOURCE[0]}" )

OUTPUT_FILE=$1
PLATFORM=$2

if [[ -z "$OUTPUT_FILE" || -z "$PLATFORM" ]]; then
  echo "Please specify the output file and target platform (.tar.gz)"
  echo "Usage: ./package.sh OUTPUT_FILE (ios|android)"
  echo "Example: ./package.sh worker.tar.gz ios"
  exit -1
fi

if [[ "$OUTPUT_FILE" != *.tar.gz ]]; then
  OUTPUT_FILE="$OUTPUT_FILE.tar.gz"
fi

echo "Building $OUTPUT_FILE"

tmp_dir=""
record_sim_build_dir=""
cleanup() {
  if [[ -n "$tmp_dir" ]]; then
    rm -rf "$tmp_dir"
  fi
  if [[ -n "$record_sim_build_dir" ]]; then
    rm -rf "$record_sim_build_dir"
  fi
}
trap cleanup EXIT

tmp_dir=$(mktemp -d)
target_root_dir="$tmp_dir"
target_worker_dir="$tmp_dir/packages/worker"
record_sim_build_dir=$(mktemp -d)

mkdir -p "$target_worker_dir"

copy_package() {
  src=$1
  dst=$2
  mkdir -p $dst
  cp "$src/package.json" "$dst/package.json"
  if [[ -f "$src/tsconfig.json" ]]; then
    cp "$src/tsconfig.json" "$dst/tsconfig.json"
  fi
  if [[ -f "$src/tsconfig.build.json" ]]; then
    cp "$src/tsconfig.build.json" "$dst/tsconfig.build.json"
  fi
  cp -r "$src/src" "$dst/src"
  if [[ -d "$src/bin" ]]; then
    cp -r "$src/bin" "$dst/bin"
  fi
}

copy_manifest() {
  src=$1
  dst=$2
  mkdir -p $dst
  cp "$src/package.json" "$dst/package.json"
  if [[ -f "$src/tsconfig.json" ]]; then
    cp "$src/tsconfig.json" "$dst/tsconfig.json"
  fi
  if [[ -f "$src/tsconfig.build.json" ]]; then
    cp "$src/tsconfig.build.json" "$dst/tsconfig.build.json"
  fi
}

cp "$ROOT_DIR/yarn.lock" $target_root_dir
cp "$ROOT_DIR/.yarnrc.yml" $target_root_dir
cp "$ROOT_DIR/package.json" $target_root_dir
cp "$ROOT_DIR/lerna.json" $target_root_dir

for package_dir in "$ROOT_DIR"/packages/*; do
  if [[ -f "$package_dir/package.json" ]]; then
    package_name=$(basename "$package_dir")
    copy_manifest "$package_dir" "$target_root_dir/packages/$package_name"
  fi
done

copy_package $WORKER_DIR $target_worker_dir
while IFS= read -r package_dir; do
  package_name=$(basename "$package_dir")
  copy_package "$package_dir" "$target_root_dir/packages/$package_name"
done <<< "$(cd "$ROOT_DIR" && yarn run -T lerna list --scope "@expo/worker" --include-dependencies --parseable --loglevel silent)"


pushd $target_root_dir >/dev/null 2>&1
yarn install --immutable
yarn run -T lerna run build --scope @expo/worker --include-dependencies
yarn workspaces focus @expo/worker --production
rm -rf tsconfig.json tsconfig.build.json
popd >/dev/null 2>&1

if [[ "$PLATFORM" != "ios" ]]; then
  rm -f "$target_root_dir/packages/build-tools/bin/record-sim"
fi

if [[ "$PLATFORM" == "ios" ]]; then
  record_sim_package_dir="$ROOT_DIR/packages/build-tools/resources/record-sim"
  record_sim_bin_dir="$target_root_dir/packages/build-tools/bin"
  mkdir -p "$record_sim_bin_dir"
  record_sim_bin_path=$(swift build \
    -c release \
    --package-path "$record_sim_package_dir" \
    --build-path "$record_sim_build_dir" \
    --show-bin-path)
  swift build \
    -c release \
    --package-path "$record_sim_package_dir" \
    --build-path "$record_sim_build_dir"
  cp "$record_sim_bin_path/record-sim" "$record_sim_bin_dir/record-sim"
  chmod +x "$record_sim_bin_dir/record-sim"

  # build plugin
  pushd "$ROOT_DIR/packages/expo-cocoapods-proxy" >/dev/null 2>&1
  if command -v brew &> /dev/null; then
    eval "$(brew shellenv)"
  else
    echo "Error: brew command not found in PATH. Please ensure Homebrew is installed and in your PATH." >&2
    exit 1
  fi
  bundle install
  gem build expo-cocoapods-proxy.gemspec
  mv expo-cocoapods-proxy-*.gem "$target_worker_dir/expo-cocoapods-proxy.gem"
  popd >/dev/null 2>&1
fi

# Bake the upterm SSH client into the worker package (build-tools/bin/upterm-<arch>) for both
# arches so jobs use the vendored binary instead of downloading it at runtime; the worker resolves
# the right one via process.arch, so a mixed-arch worker pool is fine.
upterm_version="0.24.0"
case "$PLATFORM" in
  ios) upterm_os="darwin" ;;
  android) upterm_os="linux" ;;
  *) echo "Unsupported platform for the upterm client: $PLATFORM" >&2; exit 1 ;;
esac
upterm_bin_dir="$target_root_dir/packages/build-tools/bin"
mkdir -p "$upterm_bin_dir"
for upterm_arch in amd64 arm64; do
  case "${upterm_os}_${upterm_arch}" in
    darwin_amd64) upterm_sha256="cc65a3c73e993ba22ef0fffd028dfb363529d71968380bf8f2a9804d53fe7f0a" ;;
    darwin_arm64) upterm_sha256="aafa1330bb452abd308b78ed2cead7c8bdcb1aa2c486468fbd47dd4b567a8b30" ;;
    linux_amd64) upterm_sha256="a6324d76c6d962236c22e4a27a2c4ffd17aef11dfa3da33d14dfcff4f4de60b3" ;;
    linux_arm64) upterm_sha256="9015aabeeb837ef4c503db56a54a90139b5965a9f16f162b098b1c5acf8d1584" ;;
  esac
  upterm_tarball="$tmp_dir/upterm_${upterm_os}_${upterm_arch}.tar.gz"
  curl -fsSL -o "$upterm_tarball" \
    "https://github.com/owenthereal/upterm/releases/download/v${upterm_version}/upterm_${upterm_os}_${upterm_arch}.tar.gz"
  if command -v sha256sum >/dev/null 2>&1; then
    echo "${upterm_sha256}  ${upterm_tarball}" | sha256sum -c -
  else
    echo "${upterm_sha256}  ${upterm_tarball}" | shasum -a 256 -c -
  fi
  tar -xzf "$upterm_tarball" -C "$upterm_bin_dir" upterm
  mv "$upterm_bin_dir/upterm" "$upterm_bin_dir/upterm-${upterm_arch}"
  chmod +x "$upterm_bin_dir/upterm-${upterm_arch}"
  rm -f "$upterm_tarball"
done

# Create backward-compatible symlink for orchestrator
# The orchestrator expects ./src/services/worker/dist/main.js
# but the new structure has ./packages/worker/dist/main.js
# We're only symlinking the specific file to discover any other legacy path usage
mkdir -p "$target_root_dir/src/services/worker/dist"
ln -s ../../../../packages/worker/dist/main.js "$target_root_dir/src/services/worker/dist/main.js"

tar zcf $OUTPUT_FILE -C $target_root_dir .

echo "Tarball is ready: $OUTPUT_FILE"
