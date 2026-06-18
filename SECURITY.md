# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in **apple-stocks-mcp**, please report it
privately. **Do not open a public issue for security problems.**

- Use GitHub's **[Private vulnerability reporting](https://github.com/helderpgoncalves/apple-stocks-mcp/security/advisories/new)**
  (Security tab → "Report a vulnerability"), **or**
- email the maintainer.

Please include: a description, steps to reproduce, the affected version, and the
potential impact. You'll get an acknowledgement as soon as reasonably possible.

## Scope and security model

This server is intentionally minimal in attack surface:

- **No network.** The code makes no outbound network requests — there is no HTTP
  client anywhere in `src/`. It cannot exfiltrate data over the network.
- **Read-only.** It opens the Apple Stocks SQLite caches with `sqlite3 -readonly`
  and only parses the watchlist file. It never writes to the app's data.
- **Local only.** It reads files under the current user's
  `~/Library/Group Containers/group.com.apple.stocks/` and returns results only
  to the connected MCP client.
- **Input validation.** Ticker symbols are validated against a strict allowlist
  regex before use, and external processes are invoked via `execFile` (no shell),
  so untrusted input cannot be injected into a command.

### Things worth scrutinizing in a report

- Any path that could write to or corrupt the Apple Stocks data.
- Any way untrusted tool input could reach a shell, SQL, or the filesystem
  outside the Stocks container.
- Any unexpected outbound connection.

## Supported versions

Only the latest published version on npm receives fixes. Please upgrade to the
latest `1.x` before reporting.
