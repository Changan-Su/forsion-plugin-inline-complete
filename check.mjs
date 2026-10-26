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
  // A caller abort (new keystroke) resolves to nothing.
  const ac = new AbortController(); const p = api.icSuggest({ ...c, strength: 'long' }, ac); ac.abort()
  assert.equal(await p, '')
}
console.log('check ok')
