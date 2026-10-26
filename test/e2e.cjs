// Real Electron check of the plugin: isolated home + stub engine + a built Genesis desktop, the plugin
// installed into <home>/plugins/inline-complete, a real note typed into with the real keyboard.
// Does not touch the user's installed app or dev instance.
//
// Run from the Forsion root, under the GUI lock:
//   node .claude/hooks/devlock.cjs run --vehicle=e2e --what="行内补全插件验证" --eta=4 -- node <plugin>/test/e2e.cjs
// GENESIS_DESKTOP = a built desktop checkout (default: the ghost-completion-shots worktree).
// SHOT = where to save the screenshot (default: <plugin>/test/.out/ghost.png).
const fs = require('fs'); const os = require('os'); const path = require('path')
const DESK = process.env.GENESIS_DESKTOP || '/Users/suqingyuan/Documents/Project/Forsion/.worktrees/ghost-completion-shots/desktop'
const electron = require(path.join(DESK, 'scripts/lib/launch-electron.cjs'))
const { startStubEngine } = require(path.join(DESK, 'scripts/lib/stub-engine.cjs'))
const { skipOnboarding } = require(path.join(DESK, 'scripts/lib/skip-onboarding.cjs'))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(__dirname, '.out'); fs.mkdirSync(OUT, { recursive: true })
const SHOT = process.env.SHOT || path.join(OUT, 'ghost.png')

// Test data lives here only (the plugin itself ships empty).
const NOTE = '周会纪要.md'
const BODY = `参会：产品、设计、前端、后端

## 本周进展

- 登录页改版已经上线，注册转化比上周高了 4%
- 颜色 token 收口完成，深色模式还剩几处对比度要调

## 下周安排

下周三之前把`
const ANSWER = '新版首页的设计稿和接口文档一起发给后端，周四开评审会。然后下周一开始灰度，观察一周的数据。'
const SENTENCE = '新版首页的设计稿和接口文档一起发给后端，周四开评审会。' // what "medium" keeps

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'forsion-ic-'))
  const userData = path.join(home, 'userdata'); const vault = path.join(home, 'Vault')
  fs.mkdirSync(vault, { recursive: true })
  fs.writeFileSync(path.join(vault, NOTE), BODY)
  for (const d of [userData, `${userData}-dev`]) {
    fs.mkdirSync(d, { recursive: true })
    for (const f of ['amadeus-config.json', 'amadeus-config.dev.json']) fs.writeFileSync(path.join(d, f), JSON.stringify({ lastVault: vault, localVault: vault }, null, 2))
  }
  const pdir = path.join(home, 'plugins', 'inline-complete'); fs.mkdirSync(pdir, { recursive: true })
  for (const f of ['manifest.json', 'main.js']) fs.copyFileSync(path.join(ROOT, f), path.join(pdir, f))
  // A test-only helper plugin: opens the note (ctx.app.openNote) and reports what the host gives plugins.
  const hdir = path.join(home, 'plugins', 'ic-test-helper'); fs.mkdirSync(hdir, { recursive: true })
  fs.writeFileSync(path.join(hdir, 'manifest.json'), JSON.stringify({ id: 'ic-test-helper', name: 'IC test helper', version: '1.0.0', minAppVersion: '0.0.1', description: 'e2e only' }))
  fs.writeFileSync(path.join(hdir, 'main.js'), `window.__icTest = { open: function (p) { ctx.app.openNote(p, { activate: true }) }, hasComplete: !!(ctx.tangu && ctx.tangu.complete), hasFim: !!(ctx.tangu && ctx.tangu.fim) }`)

  // Stub engine: POST /agent/inline answers like routes/inline.ts (SSE delta* → done). mode: normal | slow
  const inline = []
  let mode = 'normal'
  const sse = (frames) => ({ __buffer: Buffer.from(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')), contentType: 'text/event-stream' })
  const stub = await startStubEngine({
    models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'stub', source: 'forsion' }],
    override: async ({ path: p, method, body }) => {
      if (p !== '/agent/inline' || method !== 'POST') return undefined
      const b = await body()
      inline.push(b)
      if (b.action === 'fim') return sse([{ type: 'error', error: 'fim_unsupported' }])
      if (mode === 'slow') { await new Promise((r) => setTimeout(r, 3600)); return sse([{ type: 'done', content: '太晚了', modelId: 'gpt-6-luna' }]) }
      await new Promise((r) => setTimeout(r, 150))
      const deltas = ANSWER.match(/.{1,6}/g).map((text) => ({ type: 'delta', text }))
      return sse([...deltas, { type: 'done', content: ANSWER, modelId: 'gpt-6-luna' }])
    },
  })
  for (const d of [userData, `${userData}-dev`]) fs.writeFileSync(path.join(d, 'tangu-desktop-config.json'), JSON.stringify({ mode: 'external', backendUrl: stub.url, token: 'mock' }))
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, '--lang=zh-CN', DESK], cwd: DESK,
    env: { ...process.env, TANGU_HOME: home, TANGU_BACKEND_URL: stub.url, TANGU_HARNESS_QUIET: '1', PI_CU_SOCKET_PATH: path.join(home, 'bridge.sock') },
    timeout: 90_000,
  })
  const logs = []
  try {
    const win = await app.firstWindow({ timeout: 120_000 })
    win.on('console', (m) => { const t = m.text(); if (/inline-complete|plugin/i.test(t)) logs.push(`[${m.type()}] ${t}`) })
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1512, 950) })
    await win.waitForSelector('#root', { timeout: 30_000 })
    check('onboarding skipped', await skipOnboarding(win))
    await win.waitForSelector('.dv-groupview', { timeout: 30_000 })
    await win.waitForFunction(() => !!window.__icTest, null, { timeout: 20_000 })
    const host = await win.evaluate(() => ({ complete: window.__icTest.hasComplete, fim: window.__icTest.hasFim }))
    check('host gives plugins ctx.tangu.complete', host.complete, `fim=${host.fim}`)
    await win.evaluate((p) => window.__icTest.open(p), NOTE)
    const pm = win.locator('.ProseMirror').first()
    await pm.waitFor({ timeout: 15_000 }); await win.waitForTimeout(1200)

    const ghost = win.locator('[data-inline-complete] .ic-ghost')
    const lastP = pm.locator('p').last()
    const docText = () => pm.evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll('[data-inline-complete]').forEach((x) => x.remove()); return c.textContent })
    const placeEnd = async (loc) => { const b = await loc.boundingBox(); await win.mouse.click(b.x + b.width - 2, b.y + b.height / 2); await win.keyboard.press('End') }

    // ① type, pause → ghost
    await placeEnd(lastP)
    await win.keyboard.type('今天')
    // "medium" pause = 0.5 s; nothing may be drawn while waiting
    await win.waitForTimeout(300)
    check('nothing drawn before the pause ends', (await ghost.count()) === 0)
    await ghost.waitFor({ timeout: 4000 }).catch(() => {})
    const g1 = (await ghost.count()) ? await ghost.textContent() : null
    check('ghost appears after the pause', g1 !== null, JSON.stringify(g1))
    check('medium cuts at the end of the sentence', g1 === SENTENCE)
    check('keycap says Tab', (await win.locator('[data-inline-complete] .ic-kbd').textContent().catch(() => '')) === 'Tab')
    const req = inline[0] || {}
    check('one request, with section context', inline.length === 1 && req.action === 'custom' && /## 下周安排/.test(req.before || '') && /下周三之前把今天$/.test(req.before || '') && !/本周进展/.test(req.before || ''), JSON.stringify({ n: inline.length, action: req.action, before: req.before }))
    const color = await ghost.evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, ghost: getComputedStyle(document.documentElement).getPropertyValue('--text-ghost').trim() } })
    check('ghost uses --text-ghost', !!color.ghost, JSON.stringify(color))
    await win.mouse.move(1400, 900); await win.waitForTimeout(250)
    await win.screenshot({ path: SHOT })
    const crop = await lastP.boundingBox()
    await win.screenshot({ path: SHOT.replace(/\.png$/, '-crop.png'), clip: { x: Math.max(0, crop.x - 40), y: Math.max(0, crop.y - 220), width: Math.min(900, 1512 - crop.x + 40), height: 300 } })

    // ② type-through: matching text eats into the ghost, no new request
    await win.keyboard.type('新版')
    await win.waitForTimeout(700)
    check('type-through shrinks the ghost', (await ghost.textContent().catch(() => null)) === SENTENCE.slice(2))
    check('type-through asks nothing new', inline.length === 1, `requests=${inline.length}`)

    // ③ Cmd/Ctrl+→ accepts one word (Chinese by words)
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+ArrowRight')
    await win.waitForTimeout(200)
    const afterWord = await docText()
    check('⌘→ accepts one word', /下周三之前把今天新版首页$/.test(afterWord), afterWord.slice(-20))
    check('ghost keeps the rest', (await ghost.textContent().catch(() => null)) === SENTENCE.slice(4))

    // ④ Tab accepts all
    await win.keyboard.press('Tab')
    await win.waitForTimeout(200)
    const afterTab = await docText()
    check('Tab inserts the rest', afterTab.endsWith('今天' + SENTENCE), afterTab.slice(-40))
    check('ghost gone after Tab', (await ghost.count()) === 0)

    // ⑤ a new pause after accepting asks again; Esc dismisses and nothing is asked again
    await ghost.waitFor({ timeout: 4000 }).catch(() => {})
    check('next suggestion after accepting', (await ghost.count()) === 1, `requests=${inline.length}`)
    const before5 = await docText(); const n5 = inline.length
    await win.keyboard.press('Escape')
    await win.waitForTimeout(150)
    check('Esc clears the ghost', (await ghost.count()) === 0)
    check('Esc leaves the text alone', (await docText()) === before5)
    await win.waitForTimeout(1200)
    check('Esc does not re-ask at the same spot', inline.length === n5 && (await ghost.count()) === 0)

    // ⑥ typing something else kills the ghost
    await win.keyboard.type('另外')
    await ghost.waitFor({ timeout: 4000 }).catch(() => {})
    check('ghost after typing again', (await ghost.count()) === 1)
    await win.keyboard.type('X')
    await win.waitForTimeout(100)
    check('mismatched typing kills the ghost', (await ghost.count()) === 0)
    await win.keyboard.press('Backspace')
    await ghost.waitFor({ timeout: 4000 }).catch(() => {})
    await win.keyboard.press('Escape')

    // ⑦ caret not at the end of the paragraph: no suggestion
    const n7 = inline.length
    await win.keyboard.press('ArrowLeft'); await win.keyboard.press('ArrowLeft')
    await win.keyboard.type('的')
    await win.waitForTimeout(1200)
    check('no suggestion mid-paragraph', inline.length === n7 && (await ghost.count()) === 0, `requests=${inline.length - n7}`)

    // ⑧ the model is too slow (> 3 s): give up, draw nothing
    mode = 'slow'
    await win.keyboard.press('End'); await win.keyboard.type('再')
    await win.waitForTimeout(4800)
    check('gives up after 3 s', (await ghost.count()) === 0 && inline.length === n7 + 1, `requests=${inline.length - n7}`)
    mode = 'normal'

    // ⑨ no ghost: Tab still indents a list item (the host keeps the key)
    const item = pm.locator('li').nth(1)
    await placeEnd(item.locator('p').first())
    await win.waitForTimeout(150)
    check('no ghost before the list Tab', (await ghost.count()) === 0)
    const nestedBefore = await pm.locator('li li').count()
    await win.keyboard.press('Tab')
    await win.waitForTimeout(300)
    const nestedAfter = await pm.locator('li li').count()
    check('Tab without a ghost indents the list item', nestedAfter === nestedBefore + 1, `${nestedBefore} → ${nestedAfter}`)

    // ⑩ in a heading: no suggestion
    const n10 = inline.length
    await placeEnd(pm.locator('h2').last())
    await win.keyboard.type('一')
    await win.waitForTimeout(1200)
    check('no suggestion in a heading', inline.length === n10 && (await ghost.count()) === 0)

    // ⑪ touch: the keycap becomes a tappable 采用 pill (emulated: no hover / coarse pointer)
    await win.evaluate(() => {
      const real = window.matchMedia.bind(window)
      window.matchMedia = (q) => (/hover: none|pointer: coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q))
    })
    await placeEnd(lastP)
    await win.keyboard.type('并且')
    await ghost.waitFor({ timeout: 4000 }).catch(() => {})
    const pill = win.locator('[data-inline-complete] .ic-tap')
    check('touch shows the 采用 pill', (await pill.count()) === 1 && (await pill.textContent()) === '采用')
    if (await pill.count()) {
      await win.screenshot({ path: SHOT.replace(/\.png$/, '-touch.png') })
      const pb = await pill.boundingBox()
      await win.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2)
      await win.waitForTimeout(200)
      check('tapping the pill accepts', (await docText()).endsWith('并且' + SENTENCE) && (await ghost.count()) === 0)
    }
    await win.evaluate(() => { delete window.matchMedia })

    // ⑫ input method (CDP composition, the way a pinyin IME drives the page)
    const cdp = await win.context().newCDPSession(win)
    await placeEnd(lastP)
    await win.keyboard.type('而且')
    await ghost.waitFor({ timeout: 4000 }).catch(() => {})
    const n12 = inline.length
    check('ghost before composing', (await ghost.count()) === 1)
    await cdp.send('Input.imeSetComposition', { text: 'xin', selectionStart: 3, selectionEnd: 3 })
    await win.waitForTimeout(150)
    check('ghost hides while composing', (await ghost.count()) === 0)
    await cdp.send('Input.insertText', { text: '新版' })
    await win.waitForTimeout(300)
    check('committed text that matches eats into the ghost', (await ghost.textContent().catch(() => null)) === SENTENCE.slice(2), JSON.stringify(await ghost.textContent().catch(() => null)))
    check('composition asks nothing new', inline.length === n12, `requests=${inline.length - n12}`)
    await cdp.send('Input.imeSetComposition', { text: 'zai', selectionStart: 3, selectionEnd: 3 })
    await win.waitForTimeout(100)
    await cdp.send('Input.insertText', { text: '再' })
    await win.waitForTimeout(200)
    check('committed text that differs kills the ghost', (await ghost.count()) === 0 && (await docText()).endsWith('而且新版再'))
  } finally {
    if (logs.length) console.log('console:\n  ' + logs.slice(-15).join('\n  '))
    await app.close().catch(() => {}); stub.close?.()
    try { fs.rmSync(home, { recursive: true, force: true }) } catch { /* temp */ }
  }
  const bad = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - bad.length}/${checks.length} checks passed; screenshot ${SHOT}`)
  process.exit(bad.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
