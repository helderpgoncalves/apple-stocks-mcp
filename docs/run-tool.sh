#!/usr/bin/env bash
# Helper for the VHS demo: call one MCP tool and print its text result.
# Usage: run-tool.sh <tool> [symbol]
set -e
cd "$(dirname "$0")/.."

tool="$1"; symbol="$2"
if [ -n "$symbol" ]; then
  args="{\"symbol\":\"$symbol\"}"
  label="$tool $symbol"
else
  args="{}"
  label="$tool"
fi

printf '\033[1;32m$\033[0m \033[1m%s\033[0m\n' "$label"

printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
| node dist/index.js 2>/dev/null \
| node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{d.trim().split("\n").forEach(l=>{try{const j=JSON.parse(l);if(j.id===2)process.stdout.write(j.result.content[0].text+"\n");}catch(e){}})})'
