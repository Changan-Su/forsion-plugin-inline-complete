// Host-equivalent smoke: load main.js the way Amadeus does — `new Function('ctx', code)` — against a fake
// ctx, and check what it registers. Also checks the manifest and that zh / en messages match.
// Run: node check.mjs (no dependencies, no browser). Red = the plugin will not install; do not ship.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const dir = path.dirname(fileURLToPath(import.meta.url))
const code = readFileSync(path.join(dir, 'main.js'), 'utf8')
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const HAN = /[一-鿿]/

assert.match(manifest.id, /^[a-z0-9][a-z0-9-]{0,63}$/)
assert.equal(manifest.id, 'inline-complete')
for (const k of ['name', 'nameEn', 'description', 'descriptionEn', 'version', 'main']) assert.ok(manifest[k], `manifest.${k}`)
assert.ok(!HAN.test(manifest.nameEn) && !HAN.test(manifest.descriptionEn), 'English manifest fields carry no Chinese')
assert.ok(!/\b(import|export)\s/.test(code.replace(/\/\/.*$/gm, '')), 'main.js must not use import / export')

const el = () => ({ style: {}, classList: { add() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, appendChild(c) { return c }, remove() {} })
globalThis.document = { head: el(), createElement: el, getElementById: () => null }

function load(locale, extra = {}) {
  const got = { ext: [], cmds: [], views: [], settings: [] }
  const ctx = {
    getLocale: () => locale,
    registerEditorExtension: (f, o) => got.ext.push({ f, o }),
    registerCommand: (c) => got.cmds.push(c),
    registerSettingsView: (v) => got.views.push(v),
    registerSetting: (s) => got.settings.push(s),
    loadData: async () => null,
    saveData: async () => {},
    notify: () => {},
    app: {},
    ...extra,
  }
  new Function('ctx', code)(ctx)
  return got
}

for (const locale of ['zh', 'en']) {
  const g = load(locale, { tangu: { complete: async () => ({ text: '' }) } })
  assert.equal(g.ext.length, 1, 'one editor extension')
  assert.equal(g.ext[0].o?.priority, 'high')
  assert.deepEqual(g.cmds.map((c) => c.id).sort(), ['cycle-strength', 'toggle'])
  for (const c of g.cmds) {
    assert.equal(typeof c.title, 'function', 'command titles are read at render time')
    const title = c.title()
    assert.ok(title && (locale === 'en' ? !HAN.test(title) : HAN.test(title)), `${c.id} title in ${locale}: ${title}`)
  }
  assert.equal(g.views.length, 1, 'one settings view')
}
// Old host: no editor extensions, no tangu — loads quietly.
const quiet = console.info; console.info = () => {}
try { load('zh', { registerEditorExtension: undefined, registerSettingsView: undefined }) } finally { console.info = quiet }

// zh / en message tables: same keys, no Chinese in en, same {placeholders}.
const MSG = new Function('ctx', code + '\nreturn IC_MSG')({ registerCommand() {}, getLocale: () => 'zh' })
assert.deepEqual(Object.keys(MSG.zh).sort(), Object.keys(MSG.en).sort(), 'zh / en keys match')
for (const k of Object.keys(MSG.en)) {
  assert.ok(!HAN.test(MSG.en[k]), `en.${k} has no Chinese`)
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join()
  assert.equal(ph(MSG.zh[k]), ph(MSG.en[k]), `placeholders of ${k}`)
}
// Model path: FIM first; fim_unavailable switches to complete for the rest of the session; streams are cut.
{
  const calls = []
  let fimMode = 'stream'
  let aborted = false
  const tangu = {
    fim: (req) => {
      calls.push('fim')
      if (fimMode === 'unavailable') return Promise.reject(new Error('fim_unavailable'))
      req.signal.addEventListener('abort', () => { aborted = true })
      return new Promise((resolve, reject) => {
        for (const d of [' finish', ' the draft', ' today.', ' Then', ' more']) { if (!req.signal.aborted) req.onDelta(d) }
        if (req.signal.aborted) reject(new Error('aborted')); else resolve({ text: '' })
      })
    },
    complete: (req) => { calls.push('complete'); req.onDelta('finish it'); return Promise.resolve({ text: 'finish it' }) },
  }
  const api = new Function('ctx', code + '\nreturn { icSuggest, icSettings }')({ registerCommand() {}, getLocale: () => 'en', tangu, registerEditorExtension() {} })
  const c = { before: 'We should', after: '', strength: 'medium' }
  const a = await api.icSuggest(c, new AbortController())
  assert.equal(a, ' finish the draft today.', 'FIM text is raw and cut at the sentence end')
  assert.ok(aborted, 'stream aborted once the sentence was complete')
  fimMode = 'unavailable'
  assert.equal(await api.icSuggest(c, new AbortController()), ' finish it', 'falls back to complete, space restored')
  assert.equal(await api.icSuggest(c, new AbortController()), ' finish it')
  assert.deepEqual(calls, ['fim', 'fim', 'complete', 'complete'], 'after fim_unavailable, fim is not tried again')
  // fim streamed something, then said fim_unavailable: the stream is dropped, complete answers, and it latches.
  {
    const calls2 = []
    const t2 = {
      fim: (req) => { calls2.push('fim'); req.onDelta(' garbage'); return Promise.reject(new Error('fim_unavailable')) },
      complete: (req) => { calls2.push('complete'); req.onDelta('finish it'); return Promise.resolve({ text: 'finish it' }) },
    }
    const api2 = new Function('ctx', code + '\nreturn { icSuggest }')({ registerCommand() {}, getLocale: () => 'en', tangu: t2 })
    assert.equal(await api2.icSuggest(c, new AbortController()), ' finish it', 'partial fim text is discarded before the retry')
    assert.equal(await api2.icSuggest(c, new AbortController()), ' finish it')
    assert.deepEqual(calls2, ['fim', 'complete', 'complete'], 'fim_unavailable after a delta still latches')
  }
  // fim_catalog_unreachable (cloud catalog fetch failed) is transient: no fallback, fim is tried again.
  {
    const calls3 = []
    const t3 = {
      fim: () => { calls3.push('fim'); return Promise.reject(new Error('fim_catalog_unreachable')) },
      complete: () => { calls3.push('complete'); return Promise.resolve({ text: 'x' }) },
    }
    const api3 = new Function('ctx', code + '\nreturn { icSuggest }')({ registerCommand() {}, getLocale: () => 'en', tangu: t3 })
    const q = console.debug; console.debug = () => {}
    try {
      assert.equal(await api3.icSuggest(c, new AbortController()), '')
      assert.equal(await api3.icSuggest(c, new AbortController()), '')
    } finally { console.debug = q }
    assert.deepEqual(calls3, ['fim', 'fim'], 'transient error: no complete, no latch')
  }
  // A caller abort (new keystroke) resolves to nothing.
  const ac = new AbortController(); const p = api.icSuggest({ ...c, strength: 'long' }, ac); ac.abort()
  assert.equal(await p, '')
}
// Editor glue with a fake ProseMirror: the ghost dies on deletions; turning the plugin off clears live ghosts.
{
  let spec = null
  const keyState = new WeakMap()
  const pm = {
    PluginKey: function () { this.getState = (st) => st.__g },
    Plugin: function (sp) { spec = sp },
    DecorationSet: { create: () => ({}) }, Decoration: { widget: () => ({}) },
  }
  const cmds = []
  const ctx = { registerCommand: (x) => cmds.push(x), getLocale: () => 'en', tangu: { complete: async () => ({ text: '' }) }, saveData: async () => {}, registerEditorExtension: (f) => f(pm, {}) }
  new Function('ctx', code)(ctx)
  const text = 'Hel'
  const stateAt = (txt, head) => ({ selection: { empty: true, head, $head: { parent: { isTextblock: true, content: { size: txt.length } }, parentOffset: head, start: () => 0 } }, doc: { textBetween: (a, b) => txt.slice(a, b) } })
  const g = { anchor: 3, full: 'lo world', typed: 0, id: 1, fresh: true, hidden: false }
  const trOf = (ranges) => ({ getMeta: () => undefined, docChanged: true, selectionSet: true, mapping: { maps: [{ forEach: (cb) => ranges.forEach((r) => cb(...r)) }] } })
  const apply = (tr, st) => spec.state.apply(tr, g, null, st)
  // Backspace: "Hel" → "He", caret 2. The anchor would map to 2 and "typed" would be '' — must still die.
  assert.equal(apply(trOf([[2, 3, 2, 2]]), stateAt('He', 2)), null, 'deleting before the caret kills the ghost')
  // Replacing the prefix kills it too.
  assert.equal(apply(trOf([[0, 1, 0, 1]]), stateAt('Xel', 3)), null, 'replacing text before the caret kills the ghost')
  // Inserting somewhere else (before the caret) kills it.
  assert.equal(apply(trOf([[1, 1, 1, 2]]), stateAt('Hxel', 4)), null, 'an insertion away from the caret kills the ghost')
  // Verified type-through: "lo" inserted at the caret.
  const kept = apply(trOf([[3, 3, 3, 5]]), stateAt('Hello', 5))
  assert.ok(kept && kept.typed === 2 && kept.anchor === 3, 'typing the ghost head keeps it')
  assert.equal(apply(trOf([[3, 3, 3, 5]]), stateAt('Helxx', 5)), null, 'typing something else kills it')

  // Turning it off reaches the live editor: the visible ghost is cleared, and no more after destroy.
  const sent = []
  const view = { state: { __g: g, tr: { setMeta(k, v) { return { meta: v } } } }, dispatch(tr) { sent.push(tr.meta); view.state.__g = tr.meta }, hasFocus: () => true }
  const pv = spec.view(view)
  const toggle = cmds.find((x) => x.id === 'toggle')
  toggle.run() // off
  assert.deepEqual(sent, [null], 'disabling clears the ghost in open editors')
  assert.equal(spec.props.handleKeyDown(Object.assign(view, { state: { ...view.state, __g: g } }), { key: 'Tab' }), false, 'Tab is not taken while disabled')
  toggle.run() // on
  pv.destroy()
  view.state.__g = g
  toggle.run() // off again: the destroyed editor is not touched
  assert.equal(sent.length, 1, 'destroyed editors unsubscribe')
}
// Saved settings that can't be read (hosts from 2026-11-17 reject loadData with code 'plugin-data-unreadable'):
// paused (treated as off, no requests), nothing saved, changes refused with a notice; changes made before the read
// lands wait for it. Counted instead of fail-fast so the negative control (this block against origin/main's
// main.js) reports how many go red.
{
  let pass = 0
  const bad = []
  const ok = (name, cond, extra) => { if (cond) pass++; else bad.push(`${name}${extra === undefined ? '' : ` — ${extra}`}`) }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)) }
  const unreadable = () => Object.assign(new Error('plugin-data-unreadable'), { code: 'plugin-data-unreadable', reason: 'invalid-json' })
  const realWarn = console.warn
  console.warn = () => {}
  function boot({ locale = 'zh', loadData } = {}) {
    let spec = null
    const pm = {
      PluginKey: function () { this.getState = (st) => st.__g },
      Plugin: function (sp) { spec = sp },
      DecorationSet: { create: () => ({}) }, Decoration: { widget: () => ({}) },
    }
    const got = { cmds: [], views: [], pages: [], notes: [], saves: [], modelCalls: 0 }
    const ctx = {
      getLocale: () => locale,
      registerCommand: (c) => got.cmds.push(c),
      registerSettingsView: (v) => got.views.push(v),
      registerEditorExtension: (f) => f(pm, {}),
      notify: (m, o) => got.notes.push({ m, level: o?.level }),
      saveData: async (v) => { got.saves.push(JSON.parse(JSON.stringify(v))) },
      ui: { mountSettingsPage: (el, schema) => { got.pages.push(schema); return { update: (sc) => got.pages.push(sc), dispose() {} } } },
      tangu: { complete: async () => { got.modelCalls++; return { text: '' } } },
      ...(loadData ? { loadData } : {}),
    }
    new Function('ctx', code)(ctx)
    got.cmd = (id) => got.cmds.find((c) => c.id === id)
    got.warnings = () => got.notes.filter((n) => n.level === 'warning')
    got.item = (id) => (got.pages.at(-1)?.groups?.[0]?.items ?? []).find((it) => it.id === id)
    /** One edit in an open editor: count the pause timers it starts (a timer = a model request on its way). */
    got.typeOnce = () => {
      let timers = 0
      const realSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = () => { timers++; return 0 }
      try {
        const view = { state: { doc: {}, selection: {} }, hasFocus: () => true, dispatch() {} }
        const pv = spec?.view?.(view)
        pv?.update?.(view, { doc: { other: true }, selection: {} })
        pv?.destroy?.()
      } finally { globalThis.setTimeout = realSetTimeout }
      return timers
    }
    return got
  }

  // 1. Unreadable: paused, told once at start, nothing saved, every change refused with the notice.
  {
    const g = boot({ loadData: async () => { throw unreadable() } })
    await settle()
    ok('unreadable: one warning at start', g.warnings().length === 1, JSON.stringify(g.notes))
    ok('unreadable: warning is the zh notice', /读不出已保存的行内补全设置/.test(g.warnings()[0]?.m ?? ''), g.warnings()[0]?.m)
    ok('unreadable: treated as off (toggle shows unchecked)', g.cmd('toggle')?.checked?.() === false)
    ok('unreadable: an edit schedules no model request', g.typeOnce() === 0)
    g.cmd('toggle')?.run()
    await settle()
    ok('unreadable: toggle saves nothing', g.saves.length === 0, JSON.stringify(g.saves))
    ok('unreadable: toggle does not turn it on', g.cmd('toggle')?.checked?.() === false)
    ok('unreadable: toggle repeats the warning', g.warnings().length === 2, JSON.stringify(g.notes))
    ok('unreadable: no "is on" toast after a refused toggle', !g.notes.some((n) => /行内补全已打开/.test(n.m)), JSON.stringify(g.notes))
    g.cmd('cycle-strength')?.run()
    await settle()
    ok('unreadable: cycle-strength saves nothing', g.saves.length === 0, JSON.stringify(g.saves))
    g.views[0]?.mount?.({})
    ok('unreadable: settings page shows the notice', /读不出已保存/.test(g.item('unreadable')?.state?.title ?? ''), JSON.stringify(g.pages.at(-1)))
    ok('unreadable: settings switch shows off and is disabled', g.item('enabled')?.value === false && g.item('enabled')?.disabled === true)
    g.item('enabled')?.onChange?.(true)
    g.item('pause')?.onChange?.('500')
    await settle()
    ok('unreadable: settings page changes save nothing', g.saves.length === 0, JSON.stringify(g.saves))
    ok('unreadable: switch redrawn as off after the refused change', g.item('enabled')?.value === false)
    ok('unreadable: still no model request after the attempts', g.typeOnce() === 0 && g.modelCalls === 0)
  }
  // 2. Same in English: the notice has no Chinese.
  {
    const g = boot({ locale: 'en', loadData: async () => { throw unreadable() } })
    await settle()
    const m = g.warnings()[0]?.m ?? ''
    ok('unreadable (en): English notice', /could not be read/.test(m) && !HAN.test(m), m)
  }
  // 3. Nothing saved yet (older hosts return null for unreadable data too): defaults, saving works, no notice.
  {
    const g = boot({ loadData: async () => null })
    await settle()
    ok('null: on by default', g.cmd('toggle')?.checked?.() === true)
    ok('null: an edit schedules a request (the probe used above can see one)', g.typeOnce() === 1)
    g.cmd('toggle')?.run()
    await settle()
    ok('null: toggle saves', g.saves.length === 1 && g.saves[0].enabled === false, JSON.stringify(g.saves))
    ok('null: no warning', g.warnings().length === 0, JSON.stringify(g.notes))
  }
  // 4. Any other rejection keeps the old behaviour: defaults, saving works, no notice.
  {
    const g = boot({ loadData: async () => { throw new Error('boom') } })
    await settle()
    g.cmd('cycle-strength')?.run()
    await settle()
    ok('other error: saving works', g.saves.length === 1, JSON.stringify(g.saves))
    ok('other error: no warning', g.warnings().length === 0, JSON.stringify(g.notes))
  }
  // 5. A change made while the read is still out waits for it and lands on top of the saved settings.
  {
    let release
    const g = boot({ loadData: () => new Promise((r) => { release = r }) })
    await settle()
    ok('pending read: an edit schedules no model request yet', g.typeOnce() === 0)
    g.cmd('cycle-strength')?.run()
    await settle()
    ok('pending read: nothing saved before the read lands', g.saves.length === 0, JSON.stringify(g.saves))
    release?.({ enabled: false, strength: 'short', pause: '500' })
    await settle()
    ok('pending read: saved = original + the change', g.saves.length === 1 && JSON.stringify(g.saves[0]) === JSON.stringify({ enabled: false, strength: 'medium', pause: '500' }), JSON.stringify(g.saves))
  }
  console.warn = realWarn
  console.log(`unreadable-data checks: ${pass}/${pass + bad.length} passed`)
  for (const b of bad) console.log(`  FAIL ${b}`)
  assert.equal(bad.length, 0, 'unreadable-data checks failed')
}
console.log('check ok')
