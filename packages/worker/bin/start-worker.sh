#!/usr/bin/env bash
set -euo pipefail

# Startup setup belongs here, before the normal worker's Node process starts.
exec "$@"
