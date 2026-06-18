# Contributing

Thanks for your interest in improving **apple-stocks-mcp**! Contributions of all
kinds are welcome — bug reports, fixes, docs, and new tools.

## Ground rules

- **Read-only stays read-only.** This server must never write to, modify, or
  delete the Apple Stocks app's data. The only permitted "write" action is
  opening a URL in the Stocks app (`add_stock`). PRs that write to the app's
  store will not be merged.
- **No network calls.** The server makes zero outbound network requests by
  design. Do not add `fetch`/HTTP clients or any telemetry.
- **macOS-only at runtime,** but the pure logic must stay testable on any OS via
  the fixture-based tests.

## Development setup

```bash
git clone https://github.com/helderpgoncalves/apple-stocks-mcp.git
cd apple-stocks-mcp
npm install
npm run build      # compile to dist/
npm test           # build:test + run the test suite
npm run typecheck  # type-check without emitting
```

Tests run against **synthetic fixtures** in `test/fixtures/` and never touch your
real Apple Stocks data. `STOCKS_TEST_MODE=1` bypasses the macOS gate so logic can
be tested on Linux (this is what CI does).

To point the server at custom data while developing, use the env vars:
`STOCKS_DBSTORE_PATH`, `STOCKS_SHARED_DB_PATH`, `STOCKS_SPARKLINE_DB_PATH`,
`STOCKS_SQLITE_BIN`.

## Pull requests

1. Branch off `main`.
2. Keep changes focused; add or update tests for behavior changes.
3. Make sure `npm run typecheck`, `npm run build`, and `npm test` all pass.
4. Update `README.md` and `CHANGELOG.md` if user-facing behavior changes.
5. Open the PR with a clear description of what and why.

CI (build + tests on Node 18/20/22) must be green before merge.

## Adding a new tool

Tools live in `src/index.ts` and read data via helpers in `src/appleStocks.ts`.
When adding a tool:

- Validate any symbol input with the existing `SYMBOL_RE` / `requireSymbol`.
- Keep all SQLite access read-only (`-readonly`) and parameter-safe.
- Add a unit test against the fixtures.

## Reporting bugs

Open an issue using the bug report template. Running the `stocks_doctor` tool and
pasting its output helps a lot.

By contributing, you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
