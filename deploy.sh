#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building Android app with EAS ..."
echo

# the HA url and token come from .env.local (gitignored), the same file `expo start` uses -
# so this script holds no secrets. checked before the version bump, so a missing value fails early
ENV_FILE=.env.local
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE is missing - copy .env.example to $ENV_FILE and fill it in." >&2
  exit 1
fi
set -a
# without \r, in case the file has windows line endings - it would end up in the values
source <(tr -d '\r' < "$ENV_FILE")
set +a
: "${EXPO_PUBLIC_HA_URL:?is not set in $ENV_FILE}"
: "${EXPO_PUBLIC_HA_ACCESS_TOKEN:?is not set in $ENV_FILE}"

# the user-facing version (android's versionName) - EAS bumps the build number (versionCode) on its own
current=$(node -p "require('./package.json').version")
echo "Current version: $current"
while true; do
  read -r -p "Is this a major, minor or patch release? [major/minor/patch]: " release
  case "$release" in
    major | minor | patch) break ;;
    *) echo "Please type major, minor or patch." ;;
  esac
done

# package.json and package-lock.json, without a git commit or tag
next=$(npm version "$release" --no-git-tag-version | tr -d 'v')
# app.json's expo.version is what the app actually ships with
node -e "
const fs = require('fs');
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
app.expo.version = process.argv[1];
fs.writeFileSync('app.json', JSON.stringify(app, null, 2) + '\n');
" "$next"
echo "Version: $current -> $next (package.json, package-lock.json, app.json)"
echo

echo "Logging in to Expo Application Services ..."
npx eas-cli@latest login

echo "Setting environment variables (from $ENV_FILE) ..."
# cloud builds don't see .env.local, so copy its values to the EAS "preview" environment
# HA url
npx eas-cli@latest env:set --environment preview --name EXPO_PUBLIC_HA_URL --value "$EXPO_PUBLIC_HA_URL" --visibility plaintext
# HA access token - "sensitive" hides it in the EAS dashboard and build logs
npx eas-cli@latest env:set --environment preview --name EXPO_PUBLIC_HA_ACCESS_TOKEN --value "$EXPO_PUBLIC_HA_ACCESS_TOKEN" --visibility sensitive
# home WiFi network name - optional
if [ -n "${EXPO_PUBLIC_HOME_WIFI_NETWORK:-}" ]; then
  npx eas-cli@latest env:set --environment preview --name EXPO_PUBLIC_HOME_WIFI_NETWORK --value "$EXPO_PUBLIC_HOME_WIFI_NETWORK" --visibility plaintext
fi

echo "Starting EAS build ..."
npx eas-cli@latest build -p android --profile preview

echo
echo "Build finished, visit: https://expo.dev/accounts/thavixt/projects/home-assistant/builds"
