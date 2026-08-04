#!/bin/sh
set -eu

install_dir="${1:-}"
version="${2:-}"
if [ -z "$install_dir" ]; then
  echo "usage: bootstrap.sh INSTALL_DIR MAJOR.MINOR.PATCH" >&2
  exit 64
fi
if ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "version must be an exact MAJOR.MINOR.PATCH release" >&2
  exit 64
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skill_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
env_file="$install_dir/.env"
compose_file="$install_dir/compose.production.yml"

if [ ! -f "$skill_dir/assets/compose.production.yml" ] || [ ! -f "$skill_dir/assets/env.example" ]; then
  echo "bundled Space Station installation assets are unavailable" >&2
  exit 1
fi
if [ -e "$env_file" ]; then
  echo "existing .env was preserved; bootstrap did not modify the installation" >&2
  exit 2
fi

random_base64url() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64
  fi | tr '+/' '-_' | tr -d '=\r\n'
}

replace_value() {
  key=$1
  value=$2
  input=$3
  output=$4
  KEY="$key" VALUE="$value" awk '
    BEGIN { prefix = ENVIRON["KEY"] "="; replaced = 0 }
    index($0, prefix) == 1 {
      print prefix ENVIRON["VALUE"]
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print prefix ENVIRON["VALUE"] }
  ' "$input" >"$output"
}

umask 077
mkdir -p "$install_dir"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/space-station-bootstrap.XXXXXX")
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

cp "$skill_dir/assets/env.example" "$work_dir/config"
cp "$skill_dir/assets/compose.production.yml" "$work_dir/compose"

session_key=$(random_base64url)
preview_secret=$(random_base64url)
webhook_secret=$(random_base64url)

replace_value SPACE_STATION_VERSION "$version" "$work_dir/config" "$work_dir/next"
mv "$work_dir/next" "$work_dir/config"
replace_value AUTH_SESSION_KEYS "{\"activeKid\":\"local-v1\",\"keys\":{\"local-v1\":\"$session_key\"}}" "$work_dir/config" "$work_dir/next"
mv "$work_dir/next" "$work_dir/config"
replace_value PREVIEW_SIGNING_SECRET "$preview_secret" "$work_dir/config" "$work_dir/next"
mv "$work_dir/next" "$work_dir/config"
replace_value GITHUB_WEBHOOK_SECRET "$webhook_secret" "$work_dir/config" "$work_dir/next"
mv "$work_dir/next" "$work_dir/config"

mv "$work_dir/config" "$env_file"
mv "$work_dir/compose" "$compose_file"
chmod 600 "$env_file"
chmod 644 "$compose_file"
trap - EXIT HUP INT TERM
rm -rf "$work_dir"

printf '%s\n' "Created a private Space Station installation at $install_dir."
printf '%s\n' "Generated secrets were written without being displayed."
printf '%s\n' "Edit the GitHub App fields locally, then run check-config.sh."
