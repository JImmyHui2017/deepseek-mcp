# DeepSeek Search / Fetch MCP

[中文说明](README.md)

A local MCP server that lets Codex, Claude Code, Hermes Agent, DeepSeek Harness, OpenCode, and other MCP clients use DeepSeek's official Search and Fetch APIs.

The server exposes `deepseek_search`, `deepseek_fetch`, and `deepseek_status`. It uses standard MCP stdio and JSON-RPC, so each client can launch the same local process. The search result includes source URLs, dates, summaries, authority metadata, and optionally page content.

## Quick start

1. Run `configure.cmd` on Windows and enter your official DeepSeek API key in the hidden prompt.
2. The key is encrypted with Windows DPAPI and stored at `%APPDATA%\deepseek-search-mcp\config.json`. All clients running as the same Windows user share this configuration.
3. The setup script performs one Search and one Fetch request through MCP to verify the installation. At the current price, this can create up to two successful billable requests.
4. Restart or reconnect your MCP clients.

The key is never included in tool arguments, tool results, logs, examples, or Git files. On other operating systems, set `DEEPSEEK_API_KEY` in the MCP process environment. `DEEPSEEK_MCP_CONFIG` can point to another encrypted configuration file.

## Tools

| Tool | Purpose | Default output budget |
| --- | --- | --- |
| `deepseek_search` | Search the web and return source metadata, summaries, and available page content | 5 results; 4,000 Unicode characters per result; 16,000 total content characters |
| `deepseek_fetch` | Fetch one public HTTP/HTTPS URL as Markdown | 30,000 Unicode characters per call; supports windows with `start_char` |
| `deepseek_status` | Check local key configuration without making an upstream request | No key or account data is returned |

Example search:

```json
{
  "query": "DeepSeek site:deepseek.com after:2026-10-01",
  "count": 5,
  "need_content": true,
  "max_content_chars": 4000,
  "max_total_content_chars": 16000
}
```

Example fetch:

```json
{
  "url": "https://api-docs.deepseek.com/zh-cn/guides/search",
  "start_char": 0,
  "max_chars": 30000
}
```

`content_length` reports the complete upstream content length. `returned_characters`, `truncated`, and `next_start_char` describe the returned window. Fetching another window makes another upstream request and may be billed.

## API behavior and billing

- Search: `POST https://api.deepseek.com/v1/tools/search`
- Fetch: `POST https://api.deepseek.com/v1/tools/fetch`
- Price: CNY 5 per 1,000 successful Search or Fetch requests (USD documentation lists USD 0.75).
- Search queries are limited to 128 Unicode characters.
- Supported operators include `site:`, `-site:`, quoted phrases, `lang:`, `after:`, and `before:`.
- The documented account limits are 100 QPS for Search and 25 QPS for Fetch, with an additional per-domain Fetch limit.

Each request has a 45-second total deadline. The server supports MCP cancellation and limits one process to four concurrent Search calls and two concurrent Fetch calls. HTTP 408, 429, and 5xx responses are retried at most once; authentication, billing, security, and content errors are not retried. Ambiguous network failures and malformed successful responses are not automatically retried to avoid duplicate charges.

Search content can be cached or incomplete at the upstream service. A returned page is not proof that a subscriber-only article was fully retrieved. Preserve the source URL and verify the evidence before making a claim.

## Client registration

Run `node scripts/register.mjs` for a dry run, then `node scripts/register.mjs --apply` to add the server to detected client configurations. The registration script creates local backups and a `registration-report.json`; that report is ignored by Git and must not be published.

The current registration targets are:

- Codex: `~/.codex/config.toml`
- Claude Code: `~/.claude.json`
- Hermes Agent: the active `HERMES_HOME/config.yaml`
- DeepSeek Harness: the home-level `~/.dsh/cordis.patch.yml`, shared by profiles
- OpenCode 1 and OpenCode 2 formats

The files under `client-configs/` contain a generic placeholder path. Replace it with the local clone path before importing an example. Do not replace an entire existing client configuration with an example file.

## Development and verification

```powershell
npm ci --ignore-scripts
npm test
npm run status
npm run check:live
```

`npm test` uses mock upstream responses and fake test keys. `npm run status` is offline. `npm run check:live` uses your configured key and makes up to two successful API calls.

## License

MIT. See [LICENSE](LICENSE).

## Sources

- [DeepSeek Search and Fetch documentation](https://api-docs.deepseek.com/zh-cn/guides/search)
- [MCP TypeScript SDK stdio transport](https://ts.sdk.modelcontextprotocol.io/server.html)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp)
- [DeepSeek Harness MCP client](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers)
