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
"$pnpm_cmd" build

port="$(node -e 'const net = require("node:net"); let port = 8780; function probe() { const server = net.createServer(); server.once("error", () => { port++; probe(); }); server.listen(port, "127.0.0.1", () => server.close(() => process.stdout.write(String(port)))); } probe();')"
echo "Opening BranchLens at http://127.0.0.1:$port"
( sleep 2; open "http://127.0.0.1:$port" ) &
PORT="$port" "$pnpm_cmd" start
