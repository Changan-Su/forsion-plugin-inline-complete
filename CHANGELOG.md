# 更新日志 / Changelog

## 1.0.0 — 2026-10-26

首个版本 / First release.

- 停顿后在光标后给出灰色续写，行尾带一枚 `Tab` 键帽；Tab 全收，⌘→ / Ctrl+→ 收一个词（中文按词切），Esc 不要。
  A grey continuation after the caret with a trailing `Tab` keycap; Tab accepts all, ⌘→ / Ctrl+→ one word (Chinese by words), Esc dismisses.
- 接着打的字和灰字一样就吃掉一截，不重新问模型；输入法拼字时先藏起来，上屏后再比对。
  Typing the same text eats into the suggestion without a new request; while an input method composes, the suggestion hides and is compared again once the text is committed.
- 只在段尾出现；代码块、公式、表格、标题里，以及有选区时不出。没有灰字时 Tab 照常归宿主（列表缩进）。
  Only at the end of a paragraph; never in code blocks, math, tables, headings or with a selection. Without a suggestion Tab stays with the host (list indent).
- 长度三档：短 / 中（缺省）/ 长；停顿时长 0.3 / 0.5 / 1 秒或跟随长度。流式输出收够了就中止请求，3 秒没回就放弃。
  Three lengths (short / medium, the default / long); pause 0.3 / 0.5 / 1 s or following the length. The stream is aborted once there is enough; after 3 s without an answer the attempt is dropped.
- 优先用宿主的补全模型（`ctx.tangu.fim`），没有时退回 `ctx.tangu.complete`。
  Prefers the host's completion models (`ctx.tangu.fim`), falling back to `ctx.tangu.complete`.
- 触屏设备上键帽换成可点的「采用」，点灰字本身也算采用。
  On touch devices the keycap becomes a tappable Accept button; tapping the grey text accepts too.
