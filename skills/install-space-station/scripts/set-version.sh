#!/bin/sh
set -eu

install_dir="${1:-}"
version="${2:-}"
if [ -z "$install_dir" ] || ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "usage: set-version.sh INSTALL_DIR MAJOR.MINOR.PATCH" >&2
  exit 64
fi

env_file="$install_dir/.env"
if [ ! -f "$env_file" ]; then
  echo "local .env does not exist; run bootstrap.sh first" >&2
  exit 1
fi

umask 077
temporary=$(mktemp "${TMPDIR:-/tmp}/space-station-version.XXXXXX")
cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT HUP INT TERM

VERSION="$version" awk '
  BEGIN { prefix = "SPACE_STATION_VERSION="; replaced = 0 }
  index($0, prefix) == 1 {
    print prefix ENVIRON["VERSION"]
    replaced = 1
    next
  }
  { print }
  END { if (!replaced) print prefix ENVIRON["VERSION"] }
' "$env_file" >"$temporary"

mv "$temporary" "$env_file"
chmod 600 "$env_file"
trap - EXIT HUP INT TERM
printf '%s\n' "Space Station image version set to $version without displaying other configuration values."
