# 更新日志 / Changelog

## 1.0.1 — 2026-11-18

- 保存的设置读不出来时（文件读出错、是空的、写到一半或被手改坏），行内补全先停用、提示一次：不出灰色续写、不把文字发给模型，也不保存改动，开关和长度这次改不了（试着改会再提示一次）。以前会按缺省设置接着用，缺省是「打开」，关掉过行内补全的人会被悄悄重新打开，下一次改设置还会把原来的设置盖掉。下次启动重新读；没存过时照旧用缺省设置。需要 2026-11-17 之后的 Forsion（更早的版本读不出来时仍当没存过）。
  When the saved settings can't be read (a read error, an empty file, a write cut off halfway, or a hand edit that broke it), inline completion is paused and you're told once: no suggestions, no text sent to a model, nothing saved, and the switch and length can't be changed this run (trying tells you again). Before, the plugin carried on with the defaults, which are "on", so someone who had turned it off got it back silently, and the next settings change overwrote the saved ones. The next start reads them again; with nothing saved yet the defaults apply as before. Needs a Forsion build from 2026-11-17 or later (earlier builds still treat unreadable data as never saved).
- 设置还没读回来时不再给建议；这时改的设置等读完再改、再保存，不会只存下缺省值加这一项。
  No suggestions until the saved settings are in, and a settings change made before then waits for them instead of saving the defaults plus that one change.

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
