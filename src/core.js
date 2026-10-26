// Pure logic of the inline completion plugin: no DOM, no ctx, no ProseMirror instances.
// build.mjs pastes this file in front of src/setup.js to make main.js (a plain setup body,
// evaluated by the host as `new Function('ctx', code)`), and test/core.test.mjs loads it the
// same way. Keep it a plain script: no import / export.
var IC_CORE = (function () {
  var STRENGTHS = ['short', 'medium', 'long']
  // How far one suggestion may go. Cost: a CJK character = 1/cjk, a Latin word = 1/words.
  var LIMITS = {
    short: { cjk: 8, words: 5 },
    medium: { cjk: 30, words: 15 },
    long: { cjk: 120, words: 60 },
  }
  // Pause before asking, when the user left the pause setting on "follow length".
  var PAUSE_BY_STRENGTH = { short: 300, medium: 500, long: 1000 }
  var PAUSES = [300, 500, 1000]
  // Asked of the model. FIM gets maxTokens + stop; the chat fallback gets an instruction.
  var FIM_REQ = {
    short: { maxTokens: 24, stop: ['\n'] },
    medium: { maxTokens: 64, stop: ['\n'] },
    long: { maxTokens: 256, stop: ['\n'] },
  }

  var CJK = /[⺀-⿿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿]/
  var WORDCH = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ'’_-]/
  var PUNCT_ANY = /[，。！？；：、,.!?;:…]/
  var CJK_END = /[。！？!?…]/
  var LATIN_END = /[.!?]/
  var CLOSERS = /[”’"'」』）)\]】》]/

  function normStrength(s) { return STRENGTHS.indexOf(s) >= 0 ? s : 'medium' }
  function pauseFor(strength, pauseSetting) {
    var n = Number(pauseSetting)
    return PAUSES.indexOf(n) >= 0 ? n : PAUSE_BY_STRENGTH[normStrength(strength)]
  }

  /** Cut a (possibly still streaming) suggestion to the length the strength allows.
   *  Returns { text, done }: done = we have all we want (abort the stream now).
   *  `final` = the stream ended (or we gave up waiting), so nothing more will come. */
  function cut(raw, strength, final) {
    var lim = LIMITS[normStrength(strength)]
    var s = normStrength(strength)
    var text = String(raw || '')
    var cost = 0
    var inWord = false
    var end = text.length
    var done = !!final
    for (var i = 0; i < text.length; i++) {
      var c = text[i]
      if (c === '\n' || c === '\r') { end = i; done = true; break }
      if (CJK.test(c)) {
        inWord = false
        if (cost + 1 / lim.cjk > 1 + 1e-9) { end = i; done = true; break }
        cost += 1 / lim.cjk
        continue
      }
      if (WORDCH.test(c)) {
        if (!inWord) {
          if (cost + 1 / lim.words > 1 + 1e-9) { end = i; done = true; break }
          cost += 1 / lim.words
          inWord = true
        }
        continue
      }
      inWord = false
      if (s === 'short' && PUNCT_ANY.test(c)) {
        if (text.slice(0, i).trim()) { end = i; done = true; break }
        continue // a suggestion may start with the comma the sentence needs
      }
      if (s === 'medium') {
        if (CJK_END.test(c)) { end = takeClosers(text, i + 1); done = true; break }
        if (LATIN_END.test(c)) {
          var j = takeClosers(text, i + 1)
          if (j >= text.length) {
            // "3." could still become "3.5": undecided until the next character (or the end) arrives.
            end = j; done = !!final; break
          }
          if (/\s/.test(text[j])) { end = j; done = true; break }
        }
      }
    }
    var out = text.slice(0, end)
    // Never leave half an English word on screen while more is coming / when we gave up early.
    if (!final && end === text.length && /[A-Za-z0-9]$/.test(out)) {
      var m = /^([\s\S]*[^A-Za-z0-9'’_-])[A-Za-z0-9'’_-]+$/.exec(out)
      if (m && m[1].trim()) out = m[1]
    }
    return { text: out.replace(/\s+$/, ''), done: done }
  }
  function takeClosers(text, j) { while (j < text.length && CLOSERS.test(text[j])) j++; return j }

  /** Leading whitespace of a suggestion, relative to the text before the caret.
   *  raw = the text came from FIM (exactly what goes after the caret): trust its leading space.
   *  Otherwise (chat fallback, whose answer is trimmed) put the space back from the character
   *  before the caret, the way the design note says. */
  function fixLeadingSpace(before, text, raw) {
    var t = String(text || '')
    var prev = String(before || '').slice(-1)
    var lead = /^[ \t ]+/.exec(t)
    var body = lead ? t.slice(lead[0].length) : t
    if (!body) return ''
    if (!prev || /\s/.test(prev)) return body
    if (raw) return lead ? ' ' + body : body
    if (/[A-Za-z0-9,.;:!?)\]'’"]/.test(prev) && /^[A-Za-z0-9(\["“]/.test(body)) return ' ' + body
    return body
  }

  /** Chat models sometimes repeat the tail of the text before the caret. Drop the longest
   *  repeated part (at least 3 characters, at most 40). */
  function stripEcho(before, text) {
    var b = String(before || '')
    var t = String(text || '')
    var max = Math.min(40, b.length, t.length)
    for (var n = max; n >= 3; n--) {
      if (b.slice(-n) === t.slice(0, n)) return t.slice(n)
    }
    return t
  }

  /** Typing over a ghost: how much of the ghost the text typed since it appeared consumes.
   *  Returns the remaining ghost, '' when it is fully typed out, or null when the typed text
   *  does not match (the ghost dies). */
  function typeThrough(ghost, typed) {
    if (typeof typed !== 'string' || typeof ghost !== 'string') return null
    if (ghost.indexOf(typed) !== 0) return null
    return ghost.slice(typed.length)
  }

  /** The next word of the ghost (Cmd/Ctrl+→): Chinese by words, not characters. */
  function nextWord(t, Segmenter) {
    var S = Segmenter === undefined ? (typeof Intl !== 'undefined' ? Intl.Segmenter : null) : Segmenter
    if (S) {
      var out = ''
      var it = new S(undefined, { granularity: 'word' }).segment(t)[Symbol.iterator]()
      for (var x = it.next(); !x.done; x = it.next()) {
        out += x.value.segment
        if (x.value.isWordLike) break
      }
      return out || t
    }
    var m = /^(\s*[A-Za-z0-9'’-]+|\s*[^\sA-Za-z0-9]{1,2}|\s+)/.exec(t)
    return m ? m[0] : t
  }

  /** Whether the caret is inside unclosed inline math (`$…`) or inline code (`` `…``)
   *  in the text of its block up to the caret. */
  function insideInlineSyntax(blockBefore) {
    var s = String(blockBefore || '')
    var dollars = 0
    var ticks = 0
    for (var i = 0; i < s.length; i++) {
      var c = s[i]
      if (c === '\\') { i++; continue }
      if (c === '`') ticks++
      else if (c === '$' && ticks % 2 === 0) dollars++
    }
    return dollars % 2 === 1 || ticks % 2 === 1 || /^\s*\$\$/.test(s)
  }

  /** The block-level gate, from facts the editor glue reads off the caret position.
   *  f: { enabled, focused, editable, composing, selectionEmpty, atBlockEnd, blockType,
   *       blockIsCode, ancestors: string[], marks: string[], blockBefore } */
  function gate(f) {
    if (!f.enabled) return 'disabled'
    if (!f.focused || !f.editable) return 'unfocused'
    if (f.composing) return 'composing'
    if (!f.selectionEmpty) return 'selection'
    if (!f.atBlockEnd) return 'not-at-end'
    if (f.blockIsCode || f.blockType === 'code_block' || f.blockType === 'heading' || /math/.test(f.blockType || '')) return 'block-type'
    var anc = f.ancestors || []
    for (var i = 0; i < anc.length; i++) {
      if (/table|math|code/.test(anc[i])) return 'block-type'
    }
    var marks = f.marks || []
    for (var k = 0; k < marks.length; k++) {
      if (/code|math/i.test(marks[k])) return 'inline-code'
    }
    var bb = String(f.blockBefore || '')
    if (bb.replace(/\s/g, '').length < 2) return 'too-short'
    if (insideInlineSyntax(bb)) return 'inline-code'
    return null
  }

  /** Context for the model. blocks: the top-level blocks of the note up to and including the
   *  caret's block, as [{ text, heading: bool }], the last one cut at the caret. The prefix
   *  starts at the nearest heading (the current section) and drops whole leading blocks until
   *  it fits `cap`, so it stays byte-identical while the user types in the same section
   *  (provider prompt caching). */
  function sectionPrefix(blocks, cap) {
    cap = cap || 2000
    var start = 0
    for (var i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].heading && i < blocks.length - 1) { start = i; break }
    }
    var parts = blocks.slice(start).map(function (b) { return b.text })
    var joined = parts.join('\n\n')
    while (joined.length > cap && parts.length > 1) { parts.shift(); joined = parts.join('\n\n') }
    if (joined.length > cap) joined = joined.slice(joined.length - cap)
    return joined
  }

  var PROMPT_BASE = 'You are an inline autocomplete engine inside a note editor, like code completion in an IDE. '
    + 'The cursor is at the very end of <text_before>. Write only the text that comes next, exactly as it should be inserted at the cursor: '
    + 'no quotes, no preface, no explanation, no Markdown formatting of your own, and never repeat any text that is already written. '
    + 'Match the language, tone and style of the note. Never output a line break. '
    + 'If <text_before> ends in the middle of a word, start with the rest of that word. '
  var PROMPT_LEN = {
    short: 'Keep it very short: finish the current word and add at most a few words, stopping before the next punctuation mark.',
    medium: 'Write at most to the end of the current sentence (about 15 English words or 30 Chinese characters).',
    long: 'Write at most to the end of the current paragraph (about 120 Chinese characters or 60 English words). Do not start a new paragraph.',
  }
  function promptFor(strength) { return PROMPT_BASE + PROMPT_LEN[normStrength(strength)] }

  return {
    STRENGTHS: STRENGTHS, LIMITS: LIMITS, PAUSES: PAUSES, FIM_REQ: FIM_REQ,
    normStrength: normStrength, pauseFor: pauseFor, cut: cut, fixLeadingSpace: fixLeadingSpace,
    stripEcho: stripEcho, typeThrough: typeThrough, nextWord: nextWord, insideInlineSyntax: insideInlineSyntax,
    gate: gate, sectionPrefix: sectionPrefix, promptFor: promptFor,
  }
})()
