# VHS tape for the apple-stocks-mcp demo GIF.
# Generate with:  vhs docs/demo.tape   (outputs docs/demo.gif)
# Uses generic symbols (AAPL / NVDA / MSFT) — does not reveal the watchlist.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 760
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 18ms

Hide
Type "cd $(git rev-parse --show-toplevel 2>/dev/null || pwd) && clear"
Enter
Show

Sleep 600ms
Type "# apple-stocks-mcp — your Apple Stocks data, read locally"
Sleep 800ms
Enter
Sleep 400ms

# --- apple_stock ---
Type 'bash docs/run-tool.sh apple_stock'
Sleep 500ms
Enter
Sleep 2.4s

# --- stock_chart NVDA ---
Type 'bash docs/run-tool.sh stock_chart NVDA'
Sleep 500ms
Enter
Sleep 2.4s

# --- stock_details MSFT ---
Type 'bash docs/run-tool.sh stock_details MSFT'
Sleep 500ms
Enter
Sleep 2.6s

Type "# 100% local · read-only · no network · no API keys"
Sleep 400ms
Enter
Sleep 1.8s
