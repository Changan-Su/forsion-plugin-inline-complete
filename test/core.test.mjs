// Self-check of the pure logic in src/core.js. Run: node test/core.test.mjs (no dependencies).
// core.js is a plain script (the host pastes it into a setup body), so load it the same way.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const dir = path.dirname(fileURLToPath(import.meta.url))
const C = new Function(readFileSync(path.join(dir, '../src/core.js'), 'utf8') + '\nreturn IC_CORE')()

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok', name) }

// ── gate ──
const base = { enabled: true, focused: true, editable: true, composing: false, selectionEmpty: true, atBlockEnd: true, blockType: 'paragraph', blockIsCode: false, ancestors: ['doc'], marks: [], blockBefore: '下周三之前把' }
t('gate: plain paragraph end passes', () => assert.equal(C.gate(base), null))
t('gate: each blocker', () => {
  assert.equal(C.gate({ ...base, enabled: false }), 'disabled')
  assert.equal(C.gate({ ...base, focused: false }), 'unfocused')
  assert.equal(C.gate({ ...base, composing: true }), 'composing')
  assert.equal(C.gate({ ...base, selectionEmpty: false }), 'selection')
  assert.equal(C.gate({ ...base, atBlockEnd: false }), 'not-at-end')
  assert.equal(C.gate({ ...base, blockType: 'heading' }), 'block-type')
  assert.equal(C.gate({ ...base, blockType: 'code_block' }), 'block-type')
  assert.equal(C.gate({ ...base, blockIsCode: true, blockType: 'fence' }), 'block-type')
  assert.equal(C.gate({ ...base, ancestors: ['table_cell', 'table_row', 'table', 'doc'] }), 'block-type')
  assert.equal(C.gate({ ...base, blockType: 'math_block' }), 'block-type')
  assert.equal(C.gate({ ...base, marks: ['inlineCode'] }), 'inline-code')
  assert.equal(C.gate({ ...base, blockBefore: ' a' }), 'too-short')
})
t('gate: list item is fine', () => assert.equal(C.gate({ ...base, ancestors: ['list_item', 'bullet_list', 'doc'] }), null))
t('gate: open inline math / code blocks it, closed does not', () => {
  assert.equal(C.gate({ ...base, blockBefore: '面积是 $x^2' }), 'inline-code')
  assert.equal(C.gate({ ...base, blockBefore: '面积是 $x^2$ 平方' }), null)
  assert.equal(C.gate({ ...base, blockBefore: 'run `npm' }), 'inline-code')
  assert.equal(C.gate({ ...base, blockBefore: 'run `npm` then' }), null)
  assert.equal(C.gate({ ...base, blockBefore: 'costs \\$5 and' }), null)
  assert.equal(C.gate({ ...base, blockBefore: '$$ \\int' }), 'inline-code')
})

// ── type-through ──
t('typeThrough: prefix consumes, mismatch kills, full = empty', () => {
  const g = '新版首页的设计稿和接口文档一起发给后端，周四开评审会。'
  assert.equal(C.typeThrough(g, ''), g)
  assert.equal(C.typeThrough(g, '新版首页'), '的设计稿和接口文档一起发给后端，周四开评审会。')
  assert.equal(C.typeThrough(g, '新版首业'), null)
  assert.equal(C.typeThrough(g, g), '')
  assert.equal(C.typeThrough(' finish the draft', ' fin'), 'ish the draft')
})

// ── length cutting ──
const CJK = '新版首页的设计稿和接口文档一起发给后端，周四开评审会。然后下周一上线灰度。'
t('cut short: stops before punctuation / 8 CJK', () => {
  assert.deepEqual(C.cut('新版首页，然后', 'short', false), { text: '新版首页', done: true })
  const r = C.cut(CJK, 'short', false)
  assert.equal(r.text, '新版首页的设计稿和'.slice(0, 8)); assert.equal(r.done, true)
  assert.deepEqual(C.cut('，然后发给后端', 'short', true), { text: '，然后发给后端', done: true })
})
t('cut short: 5 English words, stops at comma', () => {
  assert.deepEqual(C.cut(' finish the draft, then send it', 'short', false), { text: ' finish the draft', done: true })
  assert.deepEqual(C.cut(' one two three four five six seven', 'short', false), { text: ' one two three four five', done: true })
})
t('cut medium: to end of sentence', () => {
  assert.deepEqual(C.cut(CJK, 'medium', false), { text: '新版首页的设计稿和接口文档一起发给后端，周四开评审会。', done: true })
  assert.deepEqual(C.cut(' send the draft to Ana. Then we wait.', 'medium', false), { text: ' send the draft to Ana.', done: true })
  // "3." may still become "3.5": undecided while streaming, done once final
  assert.deepEqual(C.cut(' version 3.', 'medium', false), { text: ' version 3.', done: false })
  assert.deepEqual(C.cut(' version 3.5 ships', 'medium', true), { text: ' version 3.5 ships', done: true })
  assert.deepEqual(C.cut('完成了。」然后', 'medium', false), { text: '完成了。」', done: true })
})
t('cut medium: caps at ~30 CJK / 15 words', () => {
  const long = '一'.repeat(50)
  assert.equal(C.cut(long, 'medium', false).text.length, 30)
  const words = Array.from({ length: 20 }, (_, i) => 'w' + i).join(' ')
  assert.equal(C.cut(' ' + words, 'medium', false).text.trim().split(/\s+/).length, 15)
})
t('cut long: through sentences, stops at newline / ~120 CJK', () => {
  assert.deepEqual(C.cut('第一句。第二句。\n新段落', 'long', false), { text: '第一句。第二句。', done: true })
  assert.equal(C.cut('字'.repeat(200), 'long', false).text.length, 120)
  assert.equal(C.cut('字'.repeat(50), 'long', false).done, false)
})
t('cut: newline always ends it; trailing half word held back while streaming', () => {
  assert.deepEqual(C.cut('\nnext paragraph', 'long', true), { text: '', done: true })
  assert.deepEqual(C.cut(' send the dra', 'long', false), { text: ' send the', done: false })
  assert.deepEqual(C.cut(' send the dra', 'long', true), { text: ' send the dra', done: true })
  assert.deepEqual(C.cut('ish', 'medium', false), { text: 'ish', done: false }) // a single partial word stays
})

// ── leading space ──
t('fixLeadingSpace: chat fallback puts the space back', () => {
  assert.equal(C.fixLeadingSpace('By Wednesday we should', 'finish the draft', false), ' finish the draft')
  assert.equal(C.fixLeadingSpace('It works.', 'Next we ship', false), ' Next we ship')
  assert.equal(C.fixLeadingSpace('By Wednesday we should ', 'finish', false), 'finish')
  assert.equal(C.fixLeadingSpace('By Wednesday we should', '  finish', false), ' finish')
  assert.equal(C.fixLeadingSpace('下周三之前把', '新版首页', false), '新版首页')
  assert.equal(C.fixLeadingSpace('we should', ', then', false), ', then')
})
t('fixLeadingSpace: FIM output is trusted', () => {
  assert.equal(C.fixLeadingSpace('Hel', 'lo world', true), 'lo world')
  assert.equal(C.fixLeadingSpace('we should', ' finish', true), ' finish')
  assert.equal(C.fixLeadingSpace('we should ', ' finish', true), 'finish')
  assert.equal(C.fixLeadingSpace('x', '   ', true), '')
})
t('stripEcho: repeated tail removed', () => {
  assert.equal(C.stripEcho('I think we should', 'we should move on'), ' move on')
  assert.equal(C.stripEcho('下周三之前把', '之前把新版首页发出去'), '新版首页发出去')
  assert.equal(C.stripEcho('abc', 'xyz'), 'xyz')
  assert.equal(C.stripEcho('哈哈', '哈哈哈'), '哈哈哈') // too short to call it an echo
  // Latin echoes only on whole words
  assert.equal(C.stripEcho('We should discuss the', 'theory of mind'), 'theory of mind')
  assert.equal(C.stripEcho('cats and', 'android apps'), 'android apps')
  assert.equal(C.stripEcho('good for', 'formal reasons'), 'formal reasons')
  assert.equal(C.stripEcho('time to bathe', 'the draft'), 'the draft')
  assert.equal(C.stripEcho('discuss the', 'the plan'), ' plan')
  assert.equal(C.stripEcho('we should', 'should move'), ' move')
})

// ── word segmentation ──
t('nextWord: Chinese by words, English by words, fallback regex', () => {
  assert.equal(C.nextWord('新版首页的设计稿'), '新版')
  assert.equal(C.nextWord(' finish the draft'), ' finish')
  assert.equal(C.nextWord('，然后'), '，然后'.slice(0, 3))
  assert.equal(C.nextWord(' finish the draft', null), ' finish')
  assert.equal(C.nextWord('新版首页', null), '新版')
})

// ── context ──
t('sectionPrefix: starts at the section heading, drops whole blocks to fit', () => {
  const blocks = [
    { text: '# 周会', heading: true }, { text: 'a'.repeat(50), heading: false },
    { text: '## 下周安排', heading: true }, { text: '第一段', heading: false }, { text: '下周三之前把', heading: false },
  ]
  assert.equal(C.sectionPrefix(blocks, 2000), '## 下周安排\n\n第一段\n\n下周三之前把')
  assert.equal(C.sectionPrefix(blocks, 10), '下周三之前把')
  assert.equal(C.sectionPrefix([{ text: 'x'.repeat(30), heading: false }], 10), 'x'.repeat(10))
  // the caret block itself being a heading does not reset the section
  assert.equal(C.sectionPrefix([{ text: 'p', heading: false }, { text: 'q', heading: false }], 100), 'p\n\nq')
})
t('pauseFor and prompts', () => {
  assert.equal(C.pauseFor('short', 'auto'), 300)
  assert.equal(C.pauseFor('medium', 'auto'), 500)
  assert.equal(C.pauseFor('long', undefined), 1000)
  assert.equal(C.pauseFor('long', '300'), 300)
  for (const s of C.STRENGTHS) assert.ok(!/[一-鿿]/.test(C.promptFor(s)), 'prompt is English')
  assert.ok(C.FIM_REQ.medium.stop.length <= 4)
})

console.log(`\n${n} checks passed`)
