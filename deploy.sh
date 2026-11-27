#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building Android app with EAS ..."
echo

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

echo "Starting EAS build ..."
npx eas-cli@latest build -p android --profile preview

echo
echo "Build finished, visit: https://expo.dev/accounts/thavixt/projects/home-assistant/builds"
