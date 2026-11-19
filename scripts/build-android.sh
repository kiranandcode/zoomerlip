#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
npm ci
npm test
npm run build
cd android
./gradlew --no-daemon :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease
