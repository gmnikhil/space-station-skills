#!/bin/sh
set -eu

install_dir="${1:-}"
if [ -z "$install_dir" ]; then
  echo "usage: check-config.sh INSTALL_DIR" >&2
  exit 64
fi
env_file="$install_dir/.env"
compose_file="$install_dir/compose.production.yml"

if [ ! -f "$env_file" ]; then
  echo "missing configuration field: .env" >&2
  exit 1
fi
if [ ! -f "$compose_file" ]; then
  echo "missing configuration field: compose.production.yml" >&2
  exit 1
fi

value_for() {
  key=$1
  KEY="$key" awk '
    BEGIN { prefix = ENVIRON["KEY"] "=" }
    index($0, prefix) == 1 {
      value = substr($0, length(prefix) + 1)
      sub(/\r$/, "", value)
      print value
      exit
    }
  ' "$env_file"
}

has_key() {
  key=$1
  KEY="$key" awk '
    BEGIN { prefix = ENVIRON["KEY"] "="; found = 0 }
    index($0, prefix) == 1 { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$env_file"
}

invalid=""
add_invalid() {
  case " $invalid " in
    *" $1 "*) ;;
    *) invalid="$invalid $1" ;;
  esac
}

for key in \
  SPACE_STATION_VERSION \
  APP_ORIGIN \
  API_ORIGIN \
  PREVIEW_ORIGIN \
  AUTH_SESSION_KEYS \
  PREVIEW_SIGNING_SECRET
do
  [ -n "$(value_for "$key")" ] || add_invalid "$key"
done

version=$(value_for SPACE_STATION_VERSION)
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || add_invalid SPACE_STATION_VERSION
[ "$(value_for APP_ORIGIN)" = "http://localhost:5173" ] || add_invalid APP_ORIGIN
[ "$(value_for API_ORIGIN)" = "http://localhost:3000" ] || add_invalid API_ORIGIN
[ "$(value_for PREVIEW_ORIGIN)" = "http://localhost:4000" ] || add_invalid PREVIEW_ORIGIN
[ "$(value_for AUTH_MODE)" = "github" ] || add_invalid AUTH_MODE
[ "$(value_for GITHUB_FIXTURE_MODE)" = "0" ] || add_invalid GITHUB_FIXTURE_MODE
[ "$(value_for AUTH_COOKIE_SECURE)" = "false" ] || add_invalid AUTH_COOKIE_SECURE

auth_methods=$(value_for GITHUB_AUTH_METHODS)
if [ -z "$auth_methods" ]; then
  # Older installations omitted this field and intentionally default to App-only.
  if has_key GITHUB_AUTH_METHODS; then
    add_invalid GITHUB_AUTH_METHODS
  else
    auth_methods=github_app
  fi
fi

app_enabled=false
pat_enabled=false
case "$auth_methods" in
  github_app) app_enabled=true ;;
  personal_access_token) pat_enabled=true ;;
  github_app,personal_access_token)
    app_enabled=true
    pat_enabled=true
    ;;
  *) add_invalid GITHUB_AUTH_METHODS ;;
esac

configured_pat=$(value_for GITHUB_CONFIGURED_PAT_LOGIN)
if [ -z "$configured_pat" ] && ! has_key GITHUB_CONFIGURED_PAT_LOGIN; then
  configured_pat=false
fi
case "$configured_pat" in
  true|false) ;;
  *) add_invalid GITHUB_CONFIGURED_PAT_LOGIN ;;
esac

personal_token=$(value_for GITHUB_PERSONAL_ACCESS_TOKEN)
if [ -n "$personal_token" ] && [ "${#personal_token}" -gt 2048 ]; then
  add_invalid GITHUB_PERSONAL_ACCESS_TOKEN
fi
if [ "$configured_pat" = "true" ]; then
  [ "$pat_enabled" = true ] || add_invalid GITHUB_AUTH_METHODS
  [ -n "$personal_token" ] || add_invalid GITHUB_PERSONAL_ACCESS_TOKEN
fi

if [ "$app_enabled" = true ]; then
  for key in \
    GITHUB_APP_ID \
    GITHUB_PRIVATE_KEY \
    GITHUB_CLIENT_ID \
    GITHUB_CLIENT_SECRET \
    GITHUB_WEBHOOK_SECRET
  do
    [ -n "$(value_for "$key")" ] || add_invalid "$key"
  done
fi

if [ -n "$invalid" ]; then
  printf '%s\n' "Missing or invalid configuration fields:" >&2
  for key in $invalid; do
    printf '  - %s\n' "$key" >&2
  done
  exit 1
fi

printf '%s\n' "Space Station configuration fields are present and use supported localhost origins."
