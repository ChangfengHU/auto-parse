#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_DIR="$ROOT_DIR/python"
VENDOR_DIR="$PYTHON_DIR/vendors/xiaohongshu_cli"
VENV_DIR="$PYTHON_DIR/.venv"
PYTHON_VERSION="${XHS_CLI_PYTHON_VERSION:-3.12}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not found in PATH." >&2
  exit 1
fi

mkdir -p "$PYTHON_DIR"
echo "$PYTHON_VERSION" > "$PYTHON_DIR/.python-version"
echo "$PYTHON_VERSION" > "$VENDOR_DIR/.python-version"

BOOTSTRAP_PYTHON="${XHS_CLI_BOOTSTRAP_PYTHON:-}"

if [[ -n "$BOOTSTRAP_PYTHON" ]]; then
  UV_PYTHON="$BOOTSTRAP_PYTHON" uv venv --allow-existing "$VENV_DIR"
else
  uv python install "$PYTHON_VERSION"
  uv venv --allow-existing --python "$PYTHON_VERSION" "$VENV_DIR"
fi

# Sync the vendored CLI into the shared project environment using the pinned lockfile.
source "$VENV_DIR/bin/activate"
uv sync --project "$VENDOR_DIR" --frozen --active

echo "Embedded XHS CLI ready."
echo "Python: $("$VENV_DIR/bin/python" --version)"
echo "Entrypoint: $VENV_DIR/bin/python -m xhs_cli.cli"
