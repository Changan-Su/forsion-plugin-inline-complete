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
console.log('check ok')
