# 行内补全 · Inline completion

Forsion / Amadeus 插件：写笔记时像 IDE 里的 Copilot 一样续写。停下来，光标后面出现一段灰色的续写，行尾一枚 `Tab` 键帽。

A Forsion / Amadeus plugin: Copilot-style completion while you write notes. Pause, and a grey continuation appears after the caret with a `Tab` keycap at its end.

## 怎么用 / How it works

| 键 / Key | 作用 / Action |
|---|---|
| `Tab` | 全收 / accept all (only while a suggestion is shown; otherwise Tab indents lists as usual) |
| `⌘→` / `Ctrl+→` | 收一个词（中文按词切） / accept one word (Chinese is split by words) |
| `Esc` | 不要 / dismiss |
| 接着打 / keep typing | 打的字和灰字一样就吃掉一截，不重新请求 / matching text eats into the suggestion, no new request |

- 只在段尾出现；代码块、公式、表格、标题里，有选区时，输入法拼字时都不出。等待时什么都不画，灰字淡入 120 ms。
  Only at the end of a paragraph; never in code blocks, math, tables, headings, with a selection, or while an input method composes. Nothing is drawn while waiting; the suggestion fades in over 120 ms.
- 灰字一次出整段（收够长度或模型说完），不边流边长；3 秒没回就放弃这一次。
  The suggestion appears in one piece (once it is long enough or the model is done), not growing token by token; after 3 s without an answer that attempt is dropped.
- 手机 / 触屏：键帽换成可点的「采用」，点灰字也算采用。
  Phones / touch: the keycap becomes a tappable Accept button; tapping the grey text accepts too.

## 设置 / Settings

插件详情页 / plugin detail page:

- **打开 / Enabled**（缺省开 / on by default）
- **长度 / Length**：短 = 补完这个词和后面一小段，到标点为止（约 8 个汉字 / 5 个英文词）；中（缺省）= 到这一句结束（约 30 字 / 15 词）；长 = 到这一段结束（约 120 字，可能折成多行）。
  Short = finish the word and a short phrase up to the next punctuation (≈ 8 CJK characters / 5 words); medium (default) = to the end of the sentence (≈ 30 / 15); long = to the end of the paragraph (≈ 120 CJK characters, may wrap).
- **停顿 / Pause**：跟随长度（短 0.3 秒 / 中 0.5 秒 / 长 1 秒）或固定 0.3 / 0.5 / 1 秒。
  Follow length (0.3 / 0.5 / 1 s) or a fixed 0.3 / 0.5 / 1 s.

命令面板 / command palette：「开关行内补全 / Toggle inline completion」「行内补全：切换长度 / Inline completion: cycle length」。

设置存在插件自己的数据里（`ctx.saveData`），不走 `registerSetting`：长度是三选一，而 `registerSetting` 只有数字 / 开关 / 文本。
Settings live in the plugin's own data (`ctx.saveData`) rather than `registerSetting`, which has no choice type.

## 模型 / Model

优先用宿主的 `ctx.tangu.fim`（「设置 → 模型 → 补全」里选的补全模型，原样续写、最省）；宿主没有它、或回 `fim_unavailable`（没有可用的补全模型）时，本次会话改用 `ctx.tangu.complete`（聊天模型 + 一段英文指令）。
发给模型的上文从当前小节的标题（没有就从笔记开头）到光标，按整块截到 2000 字以内，好让同一小节里连续打字时前缀不变、能吃到提供方的缓存；下文是后面一块的开头（≤ 300 字）。

Prefers the host's `ctx.tangu.fim` (the completion model picked in Settings → Models → Completion: raw fill-in-the-middle, cheapest). Without it, or when it answers `fim_unavailable`, the rest of the session uses `ctx.tangu.complete` (the chat model plus an English instruction). The text before the caret is sent from the current section's heading (or the note start), cut by whole blocks to ≤ 2000 characters so the prefix stays stable for provider caching; the text after is the start of the next block (≤ 300 characters).

## 开发 / Development

```bash
npm run build     # src/core.js + src/setup.js → main.js (committed; no bundler, no dependencies)
npm test          # pure logic: gate, type-through, length cutting, word split, leading space
npm run check     # loads main.js the way the host does (new Function('ctx', code)) + manifest / zh-en checks
# real Electron run (isolated home + stub engine + a built Genesis desktop), from the Forsion root, under the GUI lock:
node .claude/hooks/devlock.cjs run --vehicle=e2e --what="行内补全插件验证" --eta=4 -- node <this repo>/test/e2e.cjs
```

`GENESIS_DESKTOP` 指向一份已构建的 Genesis desktop 检出 / points at a built Genesis desktop checkout.
