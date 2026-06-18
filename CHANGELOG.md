# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.4] - 2026-06-18

### Changed

- **Much friendlier errors for a smooth first run.** The server now distinguishes
  "the Stocks app hasn't been opened yet" from "the data exists but can't be read"
  (a macOS Full Disk Access permission), and gives precise, step-by-step,
  copy-pasteable guidance for each — and makes clear the permission case is "not a
  bug". `stocks_doctor` shows the same steps.
- README: added a **Quick start (30 seconds)** section and FAQ entries for the
  first-run permission prompt and the `npx` startup timeout (`MCP_TIMEOUT`).

## [1.1.3] - 2026-06-18

### Added

- **Friendly non-macOS handling.** On Linux/Windows the server now starts cleanly
  and exposes a single `platform_info` tool that explains it's macOS-only and how
  to remove it — instead of registering 11 tools that all fail. A `platform_info`
  tool is also available on macOS (reports "all tools available").

### Notes

- Still **no telemetry and no network**: the only thing written outside tool
  results is a one-line `stderr` startup message (the platform it started on),
  which stays in the client's local logs.

## [1.1.2] - 2026-06-18

### Added

- **Claude Code plugin marketplace.** The repo is now also a Claude Code plugin
  marketplace, so users can `/plugin marketplace add helderpgoncalves/apple-stocks-mcp`
  and `/plugin install apple-stocks-mcp@apple-stocks` instead of configuring the
  MCP server by hand (`.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`,
  `.mcp.json`).
- Repository governance: `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, issue
  and PR templates, Dependabot, and a tag-triggered release workflow.

## [1.1.1] - 2026-06-18

### Added

- `mcpName` field and `server.json` so the server can be published to the
  official [MCP Registry](https://registry.modelcontextprotocol.io)
  (`io.github.helderpgoncalves/apple-stocks-mcp`).
- Richer README: animated demo GIF, badges, example outputs, per-tool field
  table, and a FAQ / troubleshooting section.

### Changed

- Reworked the documentation around privacy and legal clarity (trademark /
  nominative use, "your own data on your own Mac", not-financial-advice,
  warranty disclaimer).

## [1.1.0] - 2026-06-18

### Added

- `stock_details` — fundamentals: day & 52-week range, market cap, volume &
  average volume, P/E, EPS, beta, dividend yield, next earnings date.
- `stock_chart` — cached intraday OHLCV chart rendered as an ASCII sparkline.
- `portfolio_summary` and `top_movers` — whole-watchlist analytics.
- `search_watchlist` — match the watchlist by symbol or company name.
- `stocks_doctor` — environment diagnostics (macOS, data presence, readability,
  Full Disk Access).
- MCP **resources** (`stocks://watchlist`, `stocks://quotes`) and **prompts**
  (`analyze_portfolio`, `research_stock`).
- Test suite (Node test runner) against synthetic fixtures, and GitHub Actions
  CI on Linux / Node 18, 20, 22.

## [1.0.0] - 2026-06-18

### Added

- Initial release: a macOS-only MCP server that reads the pre-installed Apple
  Stocks app's local data.
- Tools: `list_watchlist`, `get_quote`, `quote_watchlist`, `apple_stock`,
  `add_stock` (opens the Stocks app via the `stocks://` URL scheme).

[1.1.4]: https://github.com/helderpgoncalves/apple-stocks-mcp/releases/tag/v1.1.4
[1.1.3]: https://github.com/helderpgoncalves/apple-stocks-mcp/releases/tag/v1.1.3
[1.1.2]: https://github.com/helderpgoncalves/apple-stocks-mcp/releases/tag/v1.1.2
[1.1.1]: https://github.com/helderpgoncalves/apple-stocks-mcp/releases/tag/v1.1.1
[1.1.0]: https://github.com/helderpgoncalves/apple-stocks-mcp/releases/tag/v1.1.0
[1.0.0]: https://github.com/helderpgoncalves/apple-stocks-mcp/releases/tag/v1.0.0
