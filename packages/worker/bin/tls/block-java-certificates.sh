#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
java_root=$1
[ -s "$here/blocked-certs.txt" ]

for security in "$java_root"/*/{lib/security,jre/lib/security,Contents/Home/lib/security,Contents/Home/jre/lib/security}; do
  [ -d "$security" ] || continue
  blocklist="$security/blocked.certs"
  case "$security" in */jre/lib/security) blocklist="$security/blacklisted.certs" ;; esac
  [ ! -f "$security/blacklisted.certs" ] || blocklist="$security/blacklisted.certs"
  if [ ! -f "$blocklist" ]; then printf 'Algorithm=SHA-256\n' > "$blocklist"; fi
  algorithm=$(sed -n 's/^[[:space:]]*Algorithm[[:space:]]*=[[:space:]]*//p' "$blocklist" | tr -d '\r')
  [ "$algorithm" = SHA-256 ] || { echo "Unsupported Java blocklist: $blocklist" >&2; exit 1; }
  [ -f "$blocklist.before-eas-tls-policy" ] || cp -p "$blocklist" "$blocklist.before-eas-tls-policy"
  [ -z "$(tail -c 1 "$blocklist")" ] || printf '\n' >> "$blocklist"
  while IFS= read -r fingerprint; do
    grep -Fxiq "$fingerprint" "$blocklist" || printf '%s\n' "$fingerprint" >> "$blocklist"
  done < "$here/blocked-certs.txt"
  echo "Updated Java blocklist: $blocklist"
done
