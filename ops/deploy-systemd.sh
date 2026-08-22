#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

archive=${1:-}
deploy_root=${2:-}
service_name=${3:-}
release_id=${4:-}
healthcheck_url=${5:-}

if [[ ! -f "$archive" ]]; then
  echo "Release archive not found: $archive" >&2
  exit 2
fi
if [[ "$deploy_root" != /* || "$deploy_root" == *[!A-Za-z0-9_./-]* ]]; then
  echo "Invalid deployment root" >&2
  exit 2
fi
if [[ ! "$service_name" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  echo "Invalid systemd service name" >&2
  exit 2
fi
if [[ ! "$release_id" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid release identifier" >&2
  exit 2
fi
if [[ ! "$healthcheck_url" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/[A-Za-z0-9_./-]+$ ]]; then
  echo "Health check must use loopback HTTP" >&2
  exit 2
fi

for command in curl npm node readlink sudo systemctl tar; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: $command" >&2
    exit 2
  }
done

expected_entrypoint="$deploy_root/current/src/server.mjs"
configured_entrypoint=$(systemctl show "$service_name" --property=ExecStart --value 2>/dev/null || true)
if [[ "$configured_entrypoint" != *"$expected_entrypoint"* ]]; then
  echo "The systemd unit must execute $expected_entrypoint before automated deployment is enabled" >&2
  exit 2
fi

release_root="$deploy_root/releases"
release_dir="$release_root/$release_id"
staging_dir="$release_root/.staging-$release_id-$$"
next_link="$deploy_root/.current-$release_id-$$"

cleanup() {
  rm -rf -- "$staging_dir"
  rm -f -- "$next_link" "$archive"
}
trap cleanup EXIT

mkdir -p "$release_root"

if [[ ! -d "$release_dir" ]]; then
  mkdir "$staging_dir"
  tar --extract --gzip --no-same-owner --file "$archive" --directory "$staging_dir"
  (
    cd "$staging_dir"
    npm ci --omit=dev
    npm run check
  )
  mv "$staging_dir" "$release_dir"
fi

previous_release=$(readlink -f "$deploy_root/current" 2>/dev/null || true)
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$deploy_root/current"

healthy=false
if sudo -n systemctl restart "$service_name"; then
  for attempt in {1..15}; do
    if curl --fail --silent --show-error --max-time 5 "$healthcheck_url" >/dev/null; then
      healthy=true
      break
    fi
    sleep 2
  done
fi

if [[ "$healthy" != true ]]; then
  echo "Deployment failed health verification; rolling back" >&2
  if [[ -n "$previous_release" && -d "$previous_release" && "$previous_release" != "$release_dir" ]]; then
    ln -s "$previous_release" "$next_link"
    mv -Tf "$next_link" "$deploy_root/current"
    sudo -n systemctl restart "$service_name" || true
  fi
  systemctl status "$service_name" --no-pager --lines=30 || true
  exit 1
fi

echo "Deployed $release_id to $deploy_root"
