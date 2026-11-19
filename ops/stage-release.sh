#!/usr/bin/env bash
# Copy ONLY a reviewed dist directory. Does not activate it.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source_dir=${1:?Usage: stage-release.sh DIST_DIR RELEASE_ID}
release=${2:?Release ID required (use commit plus build timestamp)}
[[ $release =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]+$ ]] || exit 1
[[ -d $source_dir && -s $source_dir/index.html && -d $source_dir/assets ]]
[[ ! -e /srv/zoomerlip/releases/$release ]]
# Dist must contain static files only, without hidden files, maps, or links.
bad=$(find "$source_dir" -mindepth 1 \( \( ! -type f -a ! -type d \) -o -name '.*' -o -name '*.map' -o -name '*.pem' -o -name '*.key' \) -print -quit)
[[ -z $bad ]] || { echo "Rejected artifact entry: $bad" >&2; exit 1; }
for entry in "$source_dir"/*; do
  case $(basename "$entry") in index.html|assets|logo.svg) ;; *) echo "Unexpected dist entry: $entry" >&2; exit 1;; esac
done
staging=$(mktemp -d /srv/zoomerlip/releases/.staging.XXXXXX)
trap 'rm -rf -- "$staging"' EXIT
cp -a -- "$source_dir"/. "$staging"/
chown -R root:root "$staging"
find "$staging" -type d -exec chmod 0755 {} +
find "$staging" -type f -exec chmod 0644 {} +
mv -- "$staging" "/srv/zoomerlip/releases/$release"
(cd "/srv/zoomerlip/releases/$release"; find . -type f -print0 | sort -z | xargs -0 sha256sum) > "/srv/zoomerlip/releases/$release.sha256"
echo "/srv/zoomerlip/releases/$release"
