#!/bin/zsh
set -e
cd "${0:A:h}"

bundled_node='/Users/loris/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'
bundled_pnpm='/Users/loris/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm'
if [[ -x "$bundled_node/node" ]]; then export PATH="$bundled_node:$PATH"; fi
if [[ -x "$bundled_pnpm" ]]; then
  pnpm_cmd="$bundled_pnpm"
elif command -v pnpm >/dev/null; then
  pnpm_cmd="$(command -v pnpm)"
else
  echo 'pnpm is not available. Open this folder in Codex and ask it to install the project dependencies.'
  read '?Press Return to close.'
  exit 1
fi

if [[ ! -d node_modules ]]; then "$pnpm_cmd" install --frozen-lockfile; fi
if [[ ! -f dist/index.html ]]; then "$pnpm_cmd" build; fi

echo 'Opening BranchLens at http://127.0.0.1:8780'
( sleep 2; open 'http://127.0.0.1:8780' ) &
"$pnpm_cmd" start
