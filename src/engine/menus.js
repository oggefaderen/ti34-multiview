// Menu model of the TI-34 MultiView emulator: every menu's static content,
// plus the navigation state machine that moves a highlight through it and
// tracks a stack of open menu screens.
//
// See docs/TI-34-SPEC.md section 3 (MODE) and section 4 (all other menus +
// the navigation model, 4.1), plus 4.9 (confirmation menus) and 6.2 (stats
// setup screens). See docs/ARCHITECTURE.md "Layering" and "DisplayModel" for
// where this module sits and the `{title, tabs, items, selected}` shape it
// must be able to produce.
//
// This module is PURE and DATA-ONLY: no rendering (no pixel/line-width
// layout — that is render.js's job), no evaluation (no math, no touching
// `ans`/vars/lists — that is calculator.js's job once it acts on a
// selection). Every exported function takes plain data in and returns new
// plain data out; nothing here mutates its arguments.
//
// ------------------------------------------------------------- Overview ---
//
// A `MenuState` is either `null` (no menu open — the Home screen, or
// whatever calculator.js is otherwise showing) or a non-empty plain array of
// `Frame`s: `[rootFrame, childFrame, ...]`, the last element being the
// screen currently on top. It is plain JSON-shaped data (arrays/objects/
// strings/numbers only), so it can be embedded in `State`, deep-compared in
// tests, and round-tripped through JSON with no special handling.
//
// A `Frame` is one open menu screen. Its shape depends on its `kind`:
//
//   kind: 'list'      { id, kind, title, items, selected }
//   kind: 'tabs'      { id, kind, tabs, activeTab, itemsByTab, selected }
//   kind: 'mode'      { id: 'mode', kind, lines, current, cursor, scrollStart }
//   kind: 'statSetup' { id, kind, title, rows, values, cursorRow }
//
// `items`/`itemsByTab[i]` are arrays of `{ key, text, label, ...extra }`:
// `key` is what a direct number/letter key-press matches ('1'..'9', 'A'..
// 'H'); `text` is the item's own text; `label` is the full printed line
// (`"${key}: ${text}"`, matching every ASCII-art menu block in the spec) —
// `label` is also exactly the field `src/ui/render.js`'s `renderMenu` reads
// off each item today, so a `Frame`'s items are already renderer-ready.
// `extra` fields (e.g. `name`/`value` on StatVars items) just ride along for
// calculator.js's benefit; render.js ignores anything besides `label`.
//
// -------------------------------------------------------------- Public API --
//
//   MENU_IDS                      every valid `id` for openMenu()
//   MODE_LINES, MODE_DEFAULTS     the MODE menu's static shape (spec 3);
//                                 calculator.js can reuse MODE_DEFAULTS as
//                                 the initial ModeState so the six defaults
//                                 live in exactly one place.
//
//   openMenu(id, ctx, stack?)  -> MenuState
//     Build the named menu and either return it as a fresh one-frame stack
//     (`stack` omitted/null), or push it onto an existing `stack` (nested
//     menu, e.g. `stat` -> `statVars`, or `dataMenu`'s Add/Edit Cnvrs ->
//     `listPicker`). Does not mutate `stack`. Throws `TypeError` for an
//     unknown `id`, or for `'statVars'` without `ctx.statResult` — these are
//     calculator.js bugs, not user-facing calculator errors (nothing here
//     ever throws `CalcError`; see ARCHITECTURE.md — only calculator.js
//     catches those, and only value.js/eos.js/stats.js throw them).
//
//     `ctx` fields, all optional, used only by the menus that need them:
//       statResult  a stats.js OneVarResult/TwoVarResult, or null/undefined
//                   — gates `stat`'s "3: StatVars" line and feeds
//                   `statVars`'s item list straight from stats.js's own
//                   `statVarMenu(result)` (never re-encoded here).
//       varValues   { x, y, z, t, a, b, c } -> already-formatted display
//                   strings, for `recall`. Formatting a Value to text is
//                   format.js's job, not this module's, so this module
//                   takes strings, not Values — an unspecified variable
//                   defaults to the text '0'.
//       mode        a ModeState (docs/ARCHITECTURE.md "format.js") used to
//                   seed `mode`'s six "current setting" markers. Missing
//                   fields fall back to MODE_DEFAULTS.
//       fields      partial `{data,frq}` (1-Var) or `{xdata,ydata}` (2-Var)
//                   to seed a stats setup screen away from its defaults
//                   (e.g. calculator.js remembering the last lists used).
//
//   navigate(stack, keyId) -> MenuState
//     Move the highlight per spec 4.1 and return a new stack; `stack` itself
//     is never mutated. `keyId` is almost always a literal key id from
//     tokens.js ('up','down','left','right','enter','clear'), plus two
//     synthetic ids this module defines because the physical keypad has no
//     matching key: digit item-select reuses tokens.js's digit ids ('d1'..
//     'd9'); letter item-select ('A'..'H', case-insensitive) is needed only
//     for the 17-item 2-Var StatVars list (spec 4.1) and has no tokens.js
//     counterpart, so calculator.js/input.js must synthesize it (e.g. from
//     a keyboard's A-H keys while such a menu is open); and 'quit' stands
//     for the resolved 2nd-then-mode combo ("2nd [quit]", spec 4.1) — exits
//     to Home unconditionally, equivalent to calling closeMenu(stack)
//     directly (also provided, and arguably the clearer spelling for that
//     specific combo).
//
//     - up/down: move the highlight (list/tabs: among the current tab's
//       items, clamped — this module does not wrap at the ends, a judgement
//       call parallel to spec section 8's unresolved items: nothing in the
//       spec says whether a TI-34 menu wraps, so we picked the simpler,
//       equally-plausible behaviour and flag it here rather than in section
//       8 of the spec itself, since it's this module's call, not a
//       transcription ambiguity). mode: move between the six lines,
//       scrolling the 4-line window as needed and resetting that line's
//       option-cursor to its *current* (committed) option. statSetup: move
//       between the field rows and the trailing CALC row.
//     - left/right: tabs: swap the active tab (there are always exactly
//       two) and reset `selected` to 0. mode: move the option-cursor within
//       the highlighted line, clamped, WITHOUT committing it (see below).
//       statSetup: cycle the highlighted field's value live, clamped —
//       there is no separate commit step for these (spec 6.2 never
//       describes pressing enter on a field, only "highlight CALC and
//       enter"). list (no tabs): no-op — nothing to switch.
//     - digit/letter: jump the highlight straight to the item whose `key`
//       matches (spec 4.1: "press the item number directly"); no-op if
//       nothing matches or the frame has no numbered items (mode,
//       statSetup). Real hardware treats this as an immediate selection,
//       not just a highlight move — see currentSelection()'s note on how
//       callers should treat digit/letter presses the same as 'enter'.
//     - enter: list/tabs/statSetup: no state change — the highlighted item
//       was already reported by currentSelection() before you called
//       navigate(), and it still is afterwards; this call exists so
//       navigate() has *something* well-defined to do with an 'enter'
//       press, and so a caller that always calls navigate() then
//       currentSelection() doesn't need a special case. mode: COMMITS the
//       highlighted option as that line's new current setting (spec 3:
//       "select with enter" — this is the one place enter does change
//       state, precisely because MODE is the one menu whose whole point is
//       "leave the old setting looking current until you deliberately pick
//       a new one").
//     - clear: pop exactly one frame (spec 4.1: "backs out one screen").
//       Popping the last frame closes the menu (returns null, never `[]` —
//       "closed" has exactly one representation).
//     - quit: close unconditionally, any depth (spec 4.1: "2nd [quit] exits
//       to Home").
//     Any other keyId, or navigate(null, ...): returned unchanged (null
//     stays null) — a safe no-op, not an error.
//
//   currentSelection(stack) -> object | null
//     Describes whatever is presently highlighted on the top frame — a
//     snapshot, not an event. It reflects the same thing regardless of how
//     the highlight got there (arrow keys, a digit/letter jump, or having
//     just been the target of 'enter'). Calculator.js decides *when* to act
//     on it: on 'enter', and — to match real hardware's "press the number,
//     it fires immediately" behaviour (spec 4.1) — also on whatever
//     digit/letter press navigate() just honoured. Shape depends on the top
//     frame's kind:
//       list/tabs:  { menu, kind, key, text, label, ...itemExtras }
//                   (tabs also adds `tab`: the active tab's name)
//       mode:       { menu:'mode', kind:'mode', lineIndex, lineKey,
//                     optionIndex, option }
//       statSetup:  { menu, kind:'statSetup', row, isCalc, values }
//                   (`row` is a field's key, or 'calc'; `values` is the
//                   live {field: currentOption} map regardless of which row
//                   is highlighted, so calculator.js can read it straight
//                   off the 'calc' selection without a second call)
//     Returns null for a closed menu (stack null/empty) or an empty list.
//
//   toMenuModel(stack) -> object | null
//     The renderer-facing projection, `null` when closed. For every kind it
//     always includes the fields `src/ui/render.js` reads today —
//     `{ title, tabs, activeTab, items, selected }`, `items[i].label` being
//     the full printed line — plus kind-specific extras a *future* renderer
//     can use (mode: `scrollUp`/`scrollDown` and, per item, `options`/
//     `currentOption` (which option is in inverse video) /`cursorOption`
//     (the navigation highlight within that line, or null off-line);
//     statSetup: the trailing CALC item carries `align:'right'` per spec
//     6.2). This module does no pixel/character layout (spec section 0's
//     5x19 menu font is render.js's concern) — these are the paging/scroll
//     facts a renderer needs, nothing more.
//
//   closeMenu(stack) -> null            always closes, any depth
//   popMenu(stack)   -> MenuState        pops one frame; empties to null
//
// ---------------------------------------------------- What calculator.js owns --
//
// Everything about *acting* on a selection: inserting a function token into
// the entry line, applying a MODE change to its own ModeState, running
// oneVarStats/twoVarStats and stashing the result as ctx.statResult for the
// next openMenu('stat', ...)/openMenu('statVars', ...), storing/recalling
// variables, clearing lists, seeding `rand`, deciding whether a selection
// should push a child menu (openMenu(id, ctx, stack)) or close the menu
// entirely (closeMenu/popMenu) or do both (act, then pop) — none of that is
// visible here. This module only ever hands back "here is what's
// highlighted"; it never mutates calculator state and never imports eos.js,
// value.js or format.js.

import { statVarMenu } from './stats.js';
import { VAR_CYCLE } from './tokens.js';

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** `[[key, text], ...]` -> `[{key, text, label}, ...]`. */
function mkItems(pairs) {
  return pairs.map(([key, text]) => ({ key, text, label: `${key}: ${text}` }));
}

function keyFromKeyId(keyId) {
  if (/^d[1-9]$/.test(keyId)) return keyId.slice(1);
  if (/^[A-Ha-h]$/.test(keyId)) return keyId.toUpperCase();
  return null;
}

function jumpIndexForKey(items, keyId) {
  const k = keyFromKeyId(keyId);
  if (k == null) return null;
  const i = items.findIndex((it) => it.key === k);
  return i === -1 ? null : i;
}

// ------------------------------------------------------- Static menu defs --
// Every menu whose content never depends on calculator state. Transcribed
// verbatim from the spec's ASCII-art blocks (4.2-4.9), with two systematic
// substitutions to match the Unicode glyphs tokens.js/format.js already use
// for the same ideas rather than the plain-ASCII stand-ins Markdown forces
// the spec doc to use: '>' -> '►' (e.g. spec's "R>Pr(" -> 'R►Pr(', matching
// tokens.js's own 'sto►'/'►simp' key labels and format.js's FUNC_LABELS),
// and "R <-> P" -> 'R◄►P' (matching tokens.js's 'toggle' key and its
// 'n/d◄►U n/d' second-function label). "theta" -> 'θ' and "^-1" -> '⁻¹'
// likewise match format.js's FUNC_LABELS ('R►Pθ', 'sin⁻¹'). The MATH menu's
// "3: ^3  (cube)" collapses its double space to one — almost certainly
// column-alignment padding in the spec's Markdown table, not meaningful
// content.

const STATIC_MENUS = {
  // spec 4.2
  prb: {
    kind: 'tabs',
    tabs: ['PRB', 'RAND'],
    itemsByTab: [
      mkItems([['1', 'nPr'], ['2', 'nCr'], ['3', '!']]),
      mkItems([['1', 'rand'], ['2', 'randint(']]),
    ],
  },

  // spec 4.3
  angle: {
    kind: 'tabs',
    tabs: ['DMS', 'R◄►P'],
    itemsByTab: [
      mkItems([['1', 'deg'], ['2', "'"], ['3', '"'], ['4', 'r'], ['5', '►DMS']]),
      mkItems([['1', 'R►Pr('], ['2', 'R►Pθ('], ['3', 'P►Rx('], ['4', 'P►Ry(']]),
    ],
  },

  // spec 4.4
  log: {
    kind: 'tabs',
    tabs: ['LOG', 'LN'],
    itemsByTab: [
      mkItems([['1', 'log('], ['2', '10^(']]),
      mkItems([['1', 'ln('], ['2', 'e^(']]),
    ],
  },

  // spec 4.5
  trig: {
    kind: 'list',
    title: 'TRIG',
    items: mkItems([
      ['1', 'sin('], ['2', 'cos('], ['3', 'tan('],
      ['4', 'sin⁻¹('], ['5', 'cos⁻¹('], ['6', 'tan⁻¹('],
    ]),
  },

  // spec 4.6
  math: {
    kind: 'tabs',
    tabs: ['MATH', 'NUM'],
    itemsByTab: [
      mkItems([['1', 'lcm('], ['2', 'gcd('], ['3', '^3 (cube)'], ['4', 'cbrt(']]),
      mkItems([
        ['1', 'abs('], ['2', 'round('], ['3', 'iPart('], ['4', 'fPart('],
        ['5', 'min('], ['6', 'max('], ['7', 'remainder('],
      ]),
    ],
  },

  // spec 4.7 (data data) — the CLEAR/CNVRSN vs CLR/FORMULA ambiguity (spec
  // section 8 #3) is resolved per the spec's own stated decision: CLEAR/CNVRSN.
  dataMenu: {
    kind: 'tabs',
    tabs: ['CLEAR', 'CNVRSN'],
    itemsByTab: [
      mkItems([['1', 'Clear L1'], ['2', 'Clear L2'], ['3', 'Clear L3'], ['4', 'Clear ALL']]),
      mkItems([
        ['1', 'Add/Edit Cnvrs'], ['2', 'Clear L1 Cnvrs'],
        ['3', 'Clear L2 Cnvrs'], ['4', 'Clear L3 Cnvrs'], ['5', 'Clear ALL'],
      ]),
    ],
  },

  // spec 4.7 — "Inside Add/Edit Cnvrs, pressing `data` opens a list picker."
  // Pushed explicitly by calculator.js (openMenu('listPicker', ctx, stack)),
  // never auto-opened by this module.
  listPicker: {
    kind: 'list',
    title: 'Ls',
    items: mkItems([['1', 'L1'], ['2', 'L2'], ['3', 'L3']]),
  },

  // spec 4.9 — Reset lists No first (the deliberate asymmetry with Clear Var).
  reset: {
    kind: 'list',
    title: 'Reset',
    items: mkItems([['1', 'No'], ['2', 'Yes']]),
  },

  // spec 4.9 — Clear Var lists Yes first.
  clearVar: {
    kind: 'list',
    title: 'Clear Var',
    items: mkItems([['1', 'Yes'], ['2', 'No']]),
  },
};

// ------------------------------------------------------------- Dynamic menus --

function buildStatFrame(ctx) {
  const pairs = [['1', '1-Var Stats'], ['2', '2-Var Stats']];
  if (ctx.statResult) pairs.push(['3', 'StatVars']);
  return { id: 'stat', kind: 'list', title: 'STATS', items: mkItems(pairs), selected: 0 };
}

function buildStatVarsFrame(ctx) {
  if (!ctx.statResult) {
    throw new TypeError("openMenu('statVars', ctx) requires ctx.statResult (spec 4.8: only reachable after a 1-Var/2-Var calculation)");
  }
  // Reuses stats.js's own ordering verbatim (spec 6.3) — never re-encoded here.
  const items = statVarMenu(ctx.statResult).map((e) => ({
    key: e.key,
    text: e.name,
    label: `${e.key}: ${e.name}`,
    name: e.name,
    value: e.value,
  }));
  return { id: 'statVars', kind: 'list', title: null, items, selected: 0 };
}

function buildRecallFrame(ctx) {
  const values = ctx.varValues || {};
  const pairs = VAR_CYCLE.map((name, i) => [String(i + 1), `${name}=${values[name] ?? '0'}`]);
  return { id: 'recall', kind: 'list', title: 'Recall Var', items: mkItems(pairs), selected: 0 };
}

// spec 3 — the six MODE lines, in order, each `{key, options}`. `key` is an
// internal handle (also usable as a ModeState field name — they match
// format.js's ModeState shape by design) rather than spec-displayed text.
export const MODE_LINES = [
  { key: 'angle', options: ['DEG', 'RAD'] },
  { key: 'notation', options: ['NORM', 'SCI'] },
  { key: 'decimals', options: ['FLOAT', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] },
  { key: 'entry', options: ['CLASSIC', 'MATHPRINT'] },
  { key: 'fracStyle', options: ['Un/d', 'n/d'] },
  { key: 'simp', options: ['MANSIMP', 'AUTOSIMP'] },
];

/** spec 3's defaults, keyed exactly like ModeState (ARCHITECTURE.md
 * "format.js") — calculator.js may reuse this directly as its initial
 * ModeState rather than re-listing the same six defaults elsewhere. */
export const MODE_DEFAULTS = {
  angle: 'DEG',
  notation: 'NORM',
  decimals: 'FLOAT',
  entry: 'MATHPRINT',
  fracStyle: 'Un/d',
  simp: 'MANSIMP',
};

const MODE_WINDOW = 4; // spec 3: "6-line menu shown 4 at a time"

function buildModeFrame(ctx) {
  const mode = { ...MODE_DEFAULTS, ...(ctx.mode || {}) };
  const current = MODE_LINES.map((line) => {
    const idx = line.options.indexOf(String(mode[line.key]));
    return idx === -1 ? 0 : idx;
  });
  return {
    id: 'mode',
    kind: 'mode',
    lines: MODE_LINES,
    current,
    cursor: { line: 0, option: current[0] },
    scrollStart: 0,
  };
}

function buildStatSetupFrame(id, ctx) {
  const isOneVar = id === 'statSetup1Var';
  const rows = isOneVar
    ? [
      { key: 'data', label: 'DATA', options: ['L1', 'L2', 'L3'] },
      { key: 'frq', label: 'FRQ', options: ['ONE', 'L1', 'L2', 'L3'] },
    ]
    : [
      { key: 'xdata', label: 'xDATA', options: ['L1', 'L2', 'L3'] },
      { key: 'ydata', label: 'yDATA', options: ['L1', 'L2', 'L3'] },
    ];
  // Defaults are not stated by the spec beyond the option orderings
  // themselves; defaulting every field to its first listed option (L1, or
  // ONE for FRQ) is the natural reading but is a judgement call, flagged
  // here as such rather than invented silently.
  const defaults = isOneVar ? { data: 'L1', frq: 'ONE' } : { xdata: 'L1', ydata: 'L1' };
  const values = { ...defaults, ...(ctx.fields || {}) };
  return {
    id,
    kind: 'statSetup',
    title: isOneVar ? '1-VAR STATS' : '2-VAR STATS',
    rows,
    values,
    cursorRow: 0,
  };
}

/** Every valid `openMenu` id. */
export const MENU_IDS = [
  'mode', 'prb', 'angle', 'log', 'trig', 'math', 'dataMenu',
  'stat', 'statVars', 'reset', 'recall', 'clearVar', 'listPicker',
  'statSetup1Var', 'statSetup2Var',
];

function buildFrame(id, ctx) {
  if (id === 'mode') return buildModeFrame(ctx);
  if (id === 'stat') return buildStatFrame(ctx);
  if (id === 'statVars') return buildStatVarsFrame(ctx);
  if (id === 'recall') return buildRecallFrame(ctx);
  if (id === 'statSetup1Var' || id === 'statSetup2Var') return buildStatSetupFrame(id, ctx);

  const def = STATIC_MENUS[id];
  if (!def) throw new TypeError(`openMenu: unknown menu id ${JSON.stringify(id)}`);
  if (def.kind === 'tabs') {
    return { id, kind: 'tabs', tabs: def.tabs.slice(), activeTab: 0, itemsByTab: def.itemsByTab, selected: 0 };
  }
  return { id, kind: 'list', title: def.title, items: def.items, selected: 0 };
}

// --------------------------------------------------------------- Public API --

/** @param {string} id @param {object} [ctx] @param {?Array} [stack] */
export function openMenu(id, ctx = {}, stack = null) {
  const frame = buildFrame(id, ctx);
  const base = stack ? stack.slice() : [];
  return [...base, frame];
}

/** Pop exactly one frame. Popping the last frame closes the menu (`null`). */
export function popMenu(stack) {
  if (!stack || stack.length === 0) return null;
  const next = stack.slice(0, -1);
  return next.length === 0 ? null : next;
}

/** Exit to Home unconditionally, regardless of stack depth. */
export function closeMenu(_stack) {
  return null;
}

function navigateList(frame, keyId) {
  const { items } = frame;
  if (keyId === 'up') return { ...frame, selected: clamp(frame.selected - 1, 0, items.length - 1) };
  if (keyId === 'down') return { ...frame, selected: clamp(frame.selected + 1, 0, items.length - 1) };
  const jump = jumpIndexForKey(items, keyId);
  return jump == null ? frame : { ...frame, selected: jump };
}

function navigateTabs(frame, keyId) {
  if (keyId === 'left' || keyId === 'right') {
    return { ...frame, activeTab: frame.activeTab === 0 ? 1 : 0, selected: 0 };
  }
  const items = frame.itemsByTab[frame.activeTab];
  if (keyId === 'up') return { ...frame, selected: clamp(frame.selected - 1, 0, items.length - 1) };
  if (keyId === 'down') return { ...frame, selected: clamp(frame.selected + 1, 0, items.length - 1) };
  const jump = jumpIndexForKey(items, keyId);
  return jump == null ? frame : { ...frame, selected: jump };
}

function scrollFor(line, scrollStart, total, windowSize) {
  const maxStart = Math.max(0, total - windowSize);
  let start = scrollStart;
  if (line < start) start = line;
  if (line > start + windowSize - 1) start = line - (windowSize - 1);
  return clamp(start, 0, maxStart);
}

function navigateMode(frame, keyId) {
  const { lines, cursor } = frame;
  if (keyId === 'up' || keyId === 'down') {
    const line = clamp(cursor.line + (keyId === 'down' ? 1 : -1), 0, lines.length - 1);
    return {
      ...frame,
      cursor: { line, option: frame.current[line] }, // landing on a line snaps to its committed option
      scrollStart: scrollFor(line, frame.scrollStart, lines.length, MODE_WINDOW),
    };
  }
  if (keyId === 'left' || keyId === 'right') {
    const optCount = lines[cursor.line].options.length;
    const option = clamp(cursor.option + (keyId === 'right' ? 1 : -1), 0, optCount - 1);
    return { ...frame, cursor: { ...cursor, option } };
  }
  if (keyId === 'enter') {
    const current = frame.current.slice();
    current[cursor.line] = cursor.option;
    return { ...frame, current };
  }
  return frame;
}

function navigateStatSetup(frame, keyId) {
  const totalRows = frame.rows.length + 1; // +1 virtual row for CALC
  if (keyId === 'up' || keyId === 'down') {
    return { ...frame, cursorRow: clamp(frame.cursorRow + (keyId === 'down' ? 1 : -1), 0, totalRows - 1) };
  }
  if (keyId === 'left' || keyId === 'right') {
    if (frame.cursorRow >= frame.rows.length) return frame; // CALC has no options
    const row = frame.rows[frame.cursorRow];
    const curIdx = row.options.indexOf(frame.values[row.key]);
    const nextIdx = clamp(curIdx + (keyId === 'right' ? 1 : -1), 0, row.options.length - 1);
    return { ...frame, values: { ...frame.values, [row.key]: row.options[nextIdx] } };
  }
  return frame;
}

/** @param {?Array} stack @param {string} keyId @returns {?Array} */
export function navigate(stack, keyId) {
  if (!stack || stack.length === 0) return stack ?? null;
  if (keyId === 'quit') return null;
  if (keyId === 'clear') return popMenu(stack);

  const frames = stack.slice();
  const top = frames[frames.length - 1];
  let nextTop;
  switch (top.kind) {
    case 'tabs': nextTop = navigateTabs(top, keyId); break;
    case 'mode': nextTop = navigateMode(top, keyId); break;
    case 'statSetup': nextTop = navigateStatSetup(top, keyId); break;
    default: nextTop = navigateList(top, keyId); break;
  }
  frames[frames.length - 1] = nextTop;
  return frames;
}

/** @param {?Array} stack @returns {?object} */
export function currentSelection(stack) {
  if (!stack || stack.length === 0) return null;
  const top = stack[stack.length - 1];

  if (top.kind === 'list') {
    const item = top.items[top.selected];
    return item ? { menu: top.id, kind: 'list', ...item } : null;
  }

  if (top.kind === 'tabs') {
    const items = top.itemsByTab[top.activeTab];
    const item = items[top.selected];
    return item ? { menu: top.id, kind: 'tabs', tab: top.tabs[top.activeTab], ...item } : null;
  }

  if (top.kind === 'mode') {
    const line = top.lines[top.cursor.line];
    return {
      menu: 'mode',
      kind: 'mode',
      lineIndex: top.cursor.line,
      lineKey: line.key,
      optionIndex: top.cursor.option,
      option: line.options[top.cursor.option],
    };
  }

  if (top.kind === 'statSetup') {
    const isCalc = top.cursorRow >= top.rows.length;
    return {
      menu: top.id,
      kind: 'statSetup',
      row: isCalc ? 'calc' : top.rows[top.cursorRow].key,
      isCalc,
      values: { ...top.values },
    };
  }

  return null;
}

/** @param {?Array} stack @returns {?object} a DisplayModel.menu-shaped object */
export function toMenuModel(stack) {
  if (!stack || stack.length === 0) return null;
  const top = stack[stack.length - 1];

  if (top.kind === 'list') {
    return {
      title: top.title,
      tabs: [],
      activeTab: 0,
      items: top.items.map((it) => ({ ...it })),
      selected: top.selected,
    };
  }

  if (top.kind === 'tabs') {
    const items = top.itemsByTab[top.activeTab];
    return {
      title: null,
      tabs: top.tabs.slice(),
      activeTab: top.activeTab,
      items: items.map((it) => ({ ...it })),
      selected: top.selected,
    };
  }

  if (top.kind === 'mode') {
    const visible = top.lines.slice(top.scrollStart, top.scrollStart + MODE_WINDOW);
    const items = visible.map((line, i) => {
      const realIndex = top.scrollStart + i;
      return {
        key: line.key,
        label: line.options.join('   '),
        options: line.options,
        currentOption: top.current[realIndex],
        cursorOption: realIndex === top.cursor.line ? top.cursor.option : null,
      };
    });
    return {
      title: null,
      tabs: [],
      activeTab: 0,
      items,
      selected: top.cursor.line - top.scrollStart,
      scrollUp: top.scrollStart > 0,
      scrollDown: top.scrollStart + MODE_WINDOW < top.lines.length,
    };
  }

  if (top.kind === 'statSetup') {
    const items = top.rows.map((row) => ({
      key: row.key,
      label: `${row.label}: ${row.options.join(' ')}`,
      current: top.values[row.key],
    }));
    items.push({ key: 'calc', label: 'CALC', align: 'right' });
    return {
      title: top.title,
      tabs: [],
      activeTab: 0,
      items,
      selected: top.cursorRow,
    };
  }

  return null;
}
