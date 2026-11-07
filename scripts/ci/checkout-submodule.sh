#!/usr/bin/env bash
# Fetches the private main-app submodule (vendor/the-library) in CI, at the commit this repo pins.
# Uses whichever credential is configured; the deploy key wins when both exist:
#   THE_LIBRARY_DEPLOY_KEY  read-only SSH deploy key on the main-app repository (preferred)
#   THE_LIBRARY_TOKEN       personal access token that can read the main-app repository
# Nothing here names this repository's owner, so moving the repo to another account changes nothing.
set -euo pipefail

# Never wait for a password: a missing or wrong credential must fail the step, not hang it.
export GIT_TERMINAL_PROMPT=0

# Only the pinned commit is fetched (--depth 1): about 140 MB instead of the full history (over 1 GB).
# If the server refuses a shallow fetch of that commit, fall back to a full clone.
update_submodule() {
    git "$@" submodule update --init --depth 1 vendor/the-library ||
        git "$@" submodule update --init vendor/the-library
}

if [ -n "${THE_LIBRARY_DEPLOY_KEY:-}" ]; then
    echo "Fetching vendor/the-library with the read-only deploy key"
    key_file="${RUNNER_TEMP:-/tmp}/the-library-deploy-key"
    printf '%s\n' "$THE_LIBRARY_DEPLOY_KEY" > "$key_file"
    chmod 600 "$key_file"
    mkdir -p ~/.ssh
    ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
    export GIT_SSH_COMMAND="ssh -i $key_file -o IdentitiesOnly=yes -o BatchMode=yes"
    update_submodule -c url."git@github.com:".insteadOf="https://github.com/"
    rm -f "$key_file"
elif [ -n "${THE_LIBRARY_TOKEN:-}" ]; then
    echo "Fetching vendor/the-library with the access token"
    update_submodule -c url."https://x-access-token:${THE_LIBRARY_TOKEN}@github.com/".insteadOf="https://github.com/"
else
    echo "::error::No credential for the main-app submodule. Add the repository secret THE_LIBRARY_TOKEN or THE_LIBRARY_DEPLOY_KEY (see README, 'Builds')."
    exit 1
fi

echo "vendor/the-library is at $(git -C vendor/the-library rev-parse HEAD)"
