#!/bin/sh
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Please install Node.js 20 or newer from https://nodejs.org/ and run this file again."
  echo
  echo "Press Enter to close..."
  read _
  exit 1
fi

node launcher.js
