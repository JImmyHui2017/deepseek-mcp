# DeepSeek Search / Fetch MCP

[English README](README.en.md)

供同一台电脑上的 Codex、Claude Code、Hermes Agent、DeepSeek Harness、OpenCode 等 MCP 客户端调用的本地搜索服务。直接使用 DeepSeek 官方 Search / Fetch 接口，执行搜索的 Agent 自己阅读资料、组织答案，不需要把任务再交给 DeepSeek 聊天模型。

## 第一次使用

1. 双击本目录的 `configure.cmd`，在隐藏输入框中填入你自己的 **DeepSeek 官方平台 API Key**。
2. 程序使用 Windows DPAPI 加密后保存到 `%APPDATA%\deepseek-search-mcp\config.json`。同一 Windows 用户下的所有客户端共用这一份配置。不要把密钥发到聊天里。
3. 配置程序自动通过 MCP 做一次 Search 和一次 Fetch 联网验证，最多产生两次成功请求，按当前价格合计约 **0.01 元人民币**。配置完成后重新打开各 Agent 的会话；有 MCP 重连功能的客户端也可单独重连。

注册器会在本机生成 `registration-report.json`，记录实际注册的客户端及原配置备份路径；该文件已被 Git 忽略，不应提交。只创建已有客户端配置对应的条目。DeepSeek Harness 写入 home 级 `~/.dsh/cordis.patch.yml`，因此适用于它的所有 profile；OpenCode 2 使用 `mcp.servers` 格式。其他支持标准 MCP 的软件可导入 `client-configs/standard-mcp.json`，或复制其中的 `command` 与 `args`，并把示例中的占位路径改为本地克隆目录。已有配置应合并服务器条目，不要用示例覆盖整个文件。

Hermes 按实际 `HERMES_HOME` 定位配置。本机使用 `%LOCALAPPDATA%\hermes\config.yaml`；当前 Windows 版未指定 `HERMES_HOME` 时也默认使用此目录。其它 Hermes profile 需要在其配置中引用同一组 `command` / `args`，密钥继续共用。

## 兼容方式

- 使用标准 **MCP stdio + JSON-RPC**；各客户端按需启动同一份 Node.js 程序。
- 工具仅依赖 MCP Tools，不要求客户端支持 Resources、Prompts、浏览器、模型插件或特定 UI。
- 每个客户端有自己的子进程，共用代码与密钥；无需常驻后台进程或本地 HTTP 端口。
- 工具同时返回 `content[].text` 与 `structuredContent`，兼容读取文本的客户端和支持结构化结果的客户端。
- stdout 只输出 MCP 消息；API Key 不进入工具参数、工具结果或日志。服务端不会把上游错误正文直接转发给模型。
- Node.js 22 或更新版本；当前机器为 Node.js 26。依赖已安装，版本由 `package-lock.json` 固定。

密钥选择顺序是进程环境变量 `DEEPSEEK_API_KEY`，然后本地 DPAPI 配置；环境变量适用于其他操作系统。DPAPI 配置只能由保存它的 Windows 用户解密。`DEEPSEEK_MCP_CONFIG` 可以指定另一份配置文件。修改加密配置后，正在运行的服务会在下一次请求时重新读取。

## 工具

| 工具 | 用途 | 默认输出控制 |
| --- | --- | --- |
| `deepseek_search` | 搜索互联网，返回 URL、日期、短摘要、长摘要、权威度和可用正文 | 5 条结果；带正文；单条正文最多 4,000 字符，总正文最多 16,000 字符 |
| `deepseek_fetch` | 读取一个 HTTP/HTTPS URL，返回 Markdown 正文 | 单次最多 30,000 字符；可指定起点和长度 |
| `deepseek_status` | 检查本地密钥配置 | 不发送联网请求，不验证余额，不返回密钥 |

搜索示例：

```json
{
  "query": "DeepSeek site:deepseek.com after:2026-10-01",
  "count": 5,
  "need_content": true,
  "max_content_chars": 4000,
  "max_total_content_chars": 16000
}
```

只需要寻找链接和摘要时，设置 `need_content: false`。需要长文时调大正文预算，上限为单条 100,000 字符、全部正文 200,000 字符。摘要和元数据不计入正文预算；上游返回它们的长度也会影响模型输入 token 数量。

抓取示例：

```json
{
  "url": "https://api-docs.deepseek.com/zh-cn/guides/search",
  "start_char": 0,
  "max_chars": 30000
}
```

输出中的 `content_length` 是该次上游响应正文的完整 Unicode 字符数，`returned_characters` 是本次返回数，`truncated` 表示只返回了窗口，`next_start_char` 指向后续窗口。字符按 Unicode 码点计数，避免截断 emoji 的代理对。返回窗口只是原始内容的一段，不会重写正文或删除 Markdown 转义符。

每次 Fetch 窗口调用都会重新请求上游，可能再次计费，而且内容可能变化。本服务不缓存响应；读取长文时可一次调大 `max_chars`，然后由 Agent 保存、分析结果。

## 接口与计费

| 项目 | 当前规则 |
| --- | --- |
| 搜索 | `POST https://api.deepseek.com/v1/tools/search` |
| 抓取 | `POST https://api.deepseek.com/v1/tools/fetch` |
| 官方价格 | Search / Fetch 各每 1,000 次成功请求 5 元人民币，美元文档为 0.75 美元 |
| 成功条件 | Search 返回非空结果；Fetch 返回正文；均要求 HTTP 200 |
| 搜索词上限 | 128 个 Unicode 字符，包含搜索算子在内 |
| 原生算子 | `site:`、`-site:`、精确短语、`lang:`、`after:`、`before:` |
| 当前官方账号限额 | Search 100 QPS，Fetch 25 QPS，另有目标域名限额 |

日期过滤推荐写完整日期，例如 `after:2026-01-01`。服务不会自行改写搜索词、语言或过滤条件。权威度和相关性评分原样保留，不据此自动丢弃长尾结果。

每次请求从排队起最多 45 秒，支持 MCP 取消。单进程最多同时执行 4 个 Search 和 2 个 Fetch；其他客户端的子进程不共享此队列，最终账号限额仍由 DeepSeek 控制。明确收到 HTTP 408、429 或 5xx 时最多重试一次；401、402、403、404 不重试；连接中断、超时和不合法的 HTTP 200 响应不自动重试，以减少重复计费。遵守 `Retry-After`，等待时间超过 5 秒则直接返回错误，由调用方决定后续处理。

网页可用性以实际返回为准。`content` 有值、返回 HTTP 200 或正文较长，都不能用来判断是否已获得完整的订阅文章；工具会保留原始来源与截断信息供核对。

## 检查、重装与注册

在本目录运行：

```powershell
npm run status
npm test
npm run check:live
```

`status` 不联网；`test` 使用 mock 和虚构测试密钥，不调用付费接口；`check:live` 使用已配置的真实密钥，通过 MCP 发起两次官方 API 调用。测试还在安装了 DeepSeek Harness 时使用它实际携带的 MCP 客户端 SDK 验证互通。

迁移到另一位置或另一台电脑后，先运行 `npm ci --ignore-scripts`。然后运行 `node scripts/register.mjs` 预览配置变更，运行 `node scripts/register.mjs --apply` 注册。已有同名条目会跳过；若目录移动，需要先移除对应客户端的旧 `deepseek-search` 条目，再注册新的路径。Windows 密钥需要重新运行 `configure.cmd` 保存。

注册器会备份原文件，只增加服务器配置，不修改 Agent 的模型选择、搜索默认规则或 skill。撤销时从客户端中删除 `deepseek-search` 条目；Harness 删除 `id: mcp-deepseek-search` 对应的 insert 块。若注册之后还修改过其它配置，建议只删除这一条，而非恢复整个旧备份。

## 来源

- [DeepSeek Search / Fetch 官方文档](https://api-docs.deepseek.com/zh-cn/guides/search)
- [MCP TypeScript SDK：本地 stdio 服务](https://ts.sdk.modelcontextprotocol.io/server.html)
- [Codex MCP 配置](https://developers.openai.com/codex/mcp)
- [DeepSeek Harness 官方 MCP 客户端](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client)
- [OpenCode 2 配置迁移](https://opencode.ai/docs/migrate-v1)

接口、计费与兼容文档核对日期：2026-11-16。
