#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export MPLCONFIGDIR="${MPLCONFIGDIR:-$project_root/.figure-cache/matplotlib}"
mkdir -p "$MPLCONFIGDIR"
exec "$project_root/.venv-figures/bin/python" "$@"
