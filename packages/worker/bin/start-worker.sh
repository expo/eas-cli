#!/usr/bin/env bash
set -euo pipefail

# Direct local development must not change the machine's Java installation.
case "${ENVIRONMENT:-}" in
  development|test) exec "$@" ;;
  staging|production) ;;
  *) echo 'Worker startup requires a known ENVIRONMENT' >&2; exit 1 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
case "${NODE_OPTIONS:-}" in
  *--use-bundled-ca*|*--use-system-ca*) echo 'Conflicting Node CA options' >&2; exit 1 ;;
esac
[ -z "${NODE_EXTRA_CA_CERTS:-}" ] || { echo 'Extra Node CA certificates require review' >&2; exit 1; }

export SSL_CERT_FILE="$here/tls/ca.pem"
export SSL_CERT_DIR="$here/tls/empty"
export CURL_CA_BUNDLE="$SSL_CERT_FILE"
export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-openssl-ca"
[ -s "$SSL_CERT_FILE" ] && [ -d "$SSL_CERT_DIR" ]

case "$(uname -s)" in
  Darwin) java_root=/Library/Java/JavaVirtualMachines ;;
  Linux) java_root=/usr/lib/jvm ;;
  *) echo 'Unsupported worker OS' >&2; exit 1 ;;
esac

# Only the Java blocklist update needs root. The worker keeps its original user.
if [ "$EUID" -eq 0 ]; then
  /bin/bash "$here/tls/block-java-certificates.sh" "$java_root"
else
  sudo -n /bin/bash "$here/tls/block-java-certificates.sh" "$java_root"
fi

exec "$@"
