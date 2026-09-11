// The state machine: keystrokes in, display out.
//
// This is the integration point. Everything below it is pure and independent
// (entry.js builds the expression, eos.js evaluates it, format.js lays it
// out, menus.js presents menus, stats.js computes statistics); this file is
// what turns a stream of key presses into calculator behaviour.
//
// The contract (docs/ARCHITECTURE.md):
//
//   initialState() -> State
//   press(state, keyId) -> State        pure
//   render(state) -> DisplayModel       pure
//
// `press` takes a KEY ID from tokens.js, never a "meaning". Pressing 'second'
// only sets a flag; the *next* press resolves the 2nd layer. That mirrors the
// hardware and keeps the UI free of calculator semantics — which is what
// makes every behaviour in the spec testable as "press these keys, check the
// screen".

import { VAR_CYCLE } from './tokens.js';
import { CalcError, isExact, reduce, simpBy, lowestPrimeFactor, toNumber } from './value.js';
import { evaluate } from './eos.js';
import * as E from './entry.js';
import * as F from './format.js';
import * as M from './menus.js';
import * as S from './stats.js';

const MAX_LINES = 4;

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export function initialState() {
  return {
    mode: { ...M.MODE_DEFAULTS },
    entry: E.emptyEntry(),
    /**
     * History items are stored raw — `{kind:'calc', nodes, value}` or
     * `{kind:'toggle', from, value}` — and formatted at render time, so a
     * change to FIX or the fraction style redraws old answers correctly
     * instead of freezing whatever was on screen when they were computed.
     */
    history: [],
    historyCursor: null, // index into history while scrolling previous entries
    ans: null,
    vars: Object.fromEntries(VAR_CYCLE.map((v) => [v, null])),
    lists: S.emptyLists(),
    statResult: null,
    menu: null,
    second: false,
    error: null,
    pendingSto: false,
    varCycleIndex: -1, // -1 = the last key press was not `var`
    randSeed: 1n,
    op: { 1: null, 2: null },
    opCount: { 1: 0, 2: 0 },
    setOpTarget: null, // 1 or 2 while defining a stored operation
  };
}

const copy = (state, over) => ({ ...state, ...over });

function evalContext(state) {
  return {
    angle: state.mode.angle,
    classic: state.mode.entry === 'CLASSIC',
    vars: state.vars,
    ans: state.ans,
    stats: state.statResult,
    randSeed: state.randSeed,
  };
}

const isClassic = (state) => state.mode.entry === 'CLASSIC';

/* -------------------------------------------------------------------------- */
/* Key tables                                                                  */
/* -------------------------------------------------------------------------- */

const DIGIT_KEYS = {
  d0: '0', d1: '1', d2: '2', d3: '3', d4: '4',
  d5: '5', d6: '6', d7: '7', d8: '8', d9: '9',
};

const OPERATOR_KEYS = { add: '+', sub: '-', mul: '*', div: '/' };

/** Menus opened by a 2nd-layer key (spec 4.1). */
const SECOND_MENUS = { math: 'angle', prb: 'log', data: 'stat', pi: 'trig' };

/* -------------------------------------------------------------------------- */
/* press                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} state
 * @param {string} keyId a key id from tokens.js
 */
export function press(state, keyId) {
  try {
    return dispatch(state, keyId);
  } catch (err) {
    if (err instanceof CalcError) {
      // Calculator-visible errors become the error display; `clear` dismisses
      // them (spec 5.11, 5.12). Anything else is a real defect and is left to
      // propagate rather than being silently swallowed.
      return copy(state, { error: err.code, second: false });
    }
    throw err;
  }
}

function dispatch(state, keyId) {
  // An error screen swallows everything except `clear` (spec 5.11).
  if (state.error) {
    if (keyId === 'clear') return copy(state, { error: null });
    return state;
  }

  if (keyId === 'second') {
    return copy(state, { second: !state.second, varCycleIndex: -1 });
  }

  const second = state.second;
  const base = copy(state, { second: false });

  // Repeated `var` presses cycle x -> y -> z -> t -> a -> b -> c (spec 5.7),
  // so only that key may keep the cycle alive.
  const s = keyId === 'var' ? base : copy(base, { varCycleIndex: -1 });

  if (state.menu) return menuKey(s, keyId, second);
  return homeKey(s, keyId, second);
}

/* ------------------------------------------------------------------ menus - */

function menuKey(state, keyId, second) {
  if (second && keyId === 'mode') return copy(state, { menu: null }); // 2nd [quit]

  const stack = M.navigate(state.menu, keyId);

  if (stack === null) return copy(state, { menu: null });
  if (stack !== state.menu && !isSelect(keyId)) return copy(state, { menu: stack });

  if (isSelect(keyId)) {
    const sel = M.currentSelection(state.menu);
    if (sel) return applySelection(copy(state, { menu: null }), sel);
  }
  return copy(state, { menu: stack });
}

const isSelect = (keyId) => keyId === 'enter';

/** Act on a chosen menu item. menus.js presents; this decides what it means. */
function applySelection(state, sel) {
  switch (sel.menu) {
    case 'mode':
      return applyModeChange(state, sel);

    case 'reset':
      return bareLabel(sel) === 'Yes' ? initialState() : state;

    case 'clearVar':
      return bareLabel(sel) === 'Yes'
        ? copy(state, { vars: Object.fromEntries(VAR_CYCLE.map((v) => [v, null])) })
        : state;

    case 'recall': {
      const name = (sel.key && VAR_CYCLE[Number(sel.key) - 1]) || null;
      const value = name ? state.vars[name] : null;
      if (value == null) return state;
      return copy(state, { entry: E.insertNode(state.entry, valueNode(value)) });
    }

    default:
      return insertMenuFunction(state, sel);
  }
}

/**
 * MODE changes (spec 3). Switching between Classic and MathPrint clears the
 * history and the stored operations — the hardware does this because the two
 * render entries differently and an op recorded in one is not meaningful in
 * the other.
 */
function applyModeChange(state, sel) {
  const mode = { ...state.mode };
  const raw = sel.option;
  mode[sel.lineKey] = sel.lineKey === 'decimals' && raw !== 'FLOAT' ? Number(raw) : raw;

  const switchedEntryMode = mode.entry !== state.mode.entry;
  return copy(state, {
    mode,
    menu: null,
    ...(switchedEntryMode
      ? { history: [], historyCursor: null, op: { 1: null, 2: null }, opCount: { 1: 0, 2: 0 } }
      : {}),
  });
}

/**
 * A menu item's own text, without the selector prefix the screen shows
 * ("1: log(", "C: Σxy"). menus.js carries both; `text` is the bare form, and
 * matching the displayed `label` instead silently matched nothing — which is
 * how every function menu came to insert nothing at all.
 */
function bareLabel(sel) {
  return String(sel.text ?? sel.label ?? '').replace(/^[0-9A-H]:\s*/, '');
}

/** Menu items that insert something into the entry line (trig, log, math...). */
function insertMenuFunction(state, sel) {
  const node = FUNCTION_NODES[bareLabel(sel)];
  if (!node) return state; // not yet wired — see the TODO list at the bottom
  return copy(state, { entry: E.insertNode(state.entry, structuredClone(node), { classic: isClassic(state) }) });
}

const fn = (v) => ({ t: 'func', v, arg: [] });

/** Menu label -> the Node eos.js expects (its header pins the names). */
const FUNCTION_NODES = {
  'sin(': fn('sin'), 'cos(': fn('cos'), 'tan(': fn('tan'),
  'sin⁻¹(': fn('asin'), 'cos⁻¹(': fn('acos'), 'tan⁻¹(': fn('atan'),
  'log(': fn('log'), 'ln(': fn('ln'),
  '10^(': fn('exp10'), 'e^(': fn('expE'),
  'lcm(': fn('lcm'), 'gcd(': fn('gcd'),
  'abs(': fn('abs'), 'round(': fn('round'),
  'iPart(': fn('ipart'), 'fPart(': fn('fpart'),
  'min(': fn('min'), 'max(': fn('max'),
  'remainder(': fn('remainder'),
  '³√(': fn('cbrt'), 'cbrt(': fn('cbrt'),
  '^3 (cube)': { t: 'postfix', v: 'cube' },
  nPr: { t: 'op', v: 'nPr' }, nCr: { t: 'op', v: 'nCr' },
  '!': { t: 'postfix', v: 'factorial' },

  // 2nd [angle] (spec 4.3). The unit modifiers are postfix: they say what
  // unit the preceding value was written in, while the result still comes
  // back in the current angle mode.
  deg: { t: 'postfix', v: 'deg' },
  "'": { t: 'postfix', v: 'min' },
  '"': { t: 'postfix', v: 'sec' },
  r: { t: 'postfix', v: 'rad' },
  '►DMS': { t: 'postfix', v: 'dms_convert' },
  'R►Pr(': fn('r2pr'), 'R►Pθ(': fn('r2ptheta'),
  'P►Rx(': fn('p2rx'), 'P►Ry(': fn('p2ry'),
};

/* ------------------------------------------------------------------- home - */

function homeKey(state, keyId, second) {
  if (second) return secondLayer(state, keyId);

  if (keyId in DIGIT_KEYS) return typeInto(state, (e) => E.insertDigit(e, DIGIT_KEYS[keyId]));
  if (keyId === 'dot') return typeInto(state, (e) => E.insertDigit(e, '.'));

  if (keyId in OPERATOR_KEYS) return pressOperator(state, OPERATOR_KEYS[keyId]);

  switch (keyId) {
    case 'enter': return pressEnter(state);
    case 'clear': return pressClear(state);
    case 'delete': return typeInto(state, E.backspace);

    case 'up': case 'down': return verticalKey(state, keyId);
    case 'left': case 'right':
      return copy(state, { entry: E.moveCursor(state.entry, keyId) });

    case 'neg': return typeInto(state, (e) => E.insertNode(e, { t: 'neg' }));
    case 'pi': return typeInto(state, (e) => E.insertNode(e, { t: 'const', v: 'pi' }));
    case 'lparen': return typeInto(state, (e) => E.insertNode(e, { t: 'paren', arg: [] }));
    case 'rparen': return copy(state, { entry: E.moveCursor(state.entry, 'right') });
    case 'square': return typeInto(state, (e) => E.insertNode(e, { t: 'postfix', v: 'square' }));
    case 'sqrt': return typeInto(state, (e) => E.insertNode(e, { t: 'sqrt', arg: [] }));
    case 'pow': return typeInto(state, (e) => E.insertNode(e, { t: 'pow', exp: [] }));
    case 'percent': return typeInto(state, (e) => E.insertNode(e, { t: 'postfix', v: 'percent' }));

    case 'ndiv': return pressFraction(state, false);
    case 'undiv': return pressFraction(state, true);

    case 'ee': return pressEE(state);
    case 'var': return pressVar(state);
    case 'sto': return copy(state, { pendingSto: true });
    case 'toggle': return pressToggle(state);
    case 'simp': return pressSimp(state);

    case 'mode': return copy(state, { menu: M.openMenu('mode', { mode: state.mode }) });
    case 'prb': return copy(state, { menu: M.openMenu('prb') });
    case 'math': return copy(state, { menu: M.openMenu('math') });
    case 'data': return copy(state, { menu: M.openMenu('dataMenu') });

    case 'op1': return pressOp(state, 1);
    case 'op2': return pressOp(state, 2);

    case 'on': return state; // already on
    default: return state;
  }
}

function secondLayer(state, keyId) {
  if (keyId in SECOND_MENUS) {
    return copy(state, { menu: M.openMenu(SECOND_MENUS[keyId], { statResult: state.statResult }) });
  }

  switch (keyId) {
    case 'mode': return copy(state, { menu: null }); // quit
    case 'delete': return copy(state, { entry: E.setInsertMode(state.entry, true) });
    case 'd0': return copy(state, { menu: M.openMenu('reset') });
    case 'var': return copy(state, { menu: M.openMenu('clearVar') });
    case 'sto': return copy(state, { menu: M.openMenu('recall', { vars: state.vars }) });

    case 'neg': // 2nd [ans]
      return state.ans == null ? state
        : typeInto(state, (e) => E.insertNode(e, { t: 'ans' }));

    case 'div': return pressOperator(state, 'intdiv');
    case 'pow': return typeInto(state, (e) => E.insertNode(e, { t: 'root', idx: [], arg: [] }));

    case 'ee': // 1/x
      return typeInto(state, (e) =>
        E.insertNode(e, { t: 'pow', exp: [{ t: 'neg' }, { t: 'num', v: '1' }] }));

    case 'ndiv': return typeInto(state, (e) => E.insertNode(e, { t: 'postfix', v: 'frac_convert' }));
    case 'undiv': return typeInto(state, (e) => E.insertNode(e, { t: 'postfix', v: 'frac_convert' }));
    case 'percent': return typeInto(state, (e) => E.insertNode(e, { t: 'postfix', v: 'pct_convert' }));

    case 'up': return jumpHistory(state, 'oldest');
    case 'down': return copy(state, { historyCursor: null });

    case 'op1': return copy(state, { setOpTarget: 1, entry: E.emptyEntry() });
    case 'op2': return copy(state, { setOpTarget: 2, entry: E.emptyEntry() });

    // Contrast and power are physical concerns with no effect on results.
    case 'add': case 'sub': case 'on': return state;
    default: return state;
  }
}

/** Typing always leaves the history-scroll view (spec 2.3). */
function typeInto(state, f) {
  return copy(state, { entry: f(state.entry), historyCursor: null });
}

/**
 * An entry that *starts* with an operator implicitly recalls `ans`
 * (spec 5.6) — the display then reads `ans` followed by that operator.
 */
function pressOperator(state, op) {
  let entry = state.entry;
  if (E.isEmpty(entry) && state.ans != null) {
    entry = E.insertNode(entry, { t: 'ans' });
  }
  return copy(state, { entry: E.insertNode(entry, { t: 'op', v: op }), historyCursor: null });
}

/**
 * `n/d` / `U n/d` (spec 5.5). In Classic there is no DOWN-into-the-
 * denominator, so pressing the key again while already inside a fraction
 * advances to the denominator instead of nesting a second fraction.
 */
function pressFraction(state, mixed) {
  const classic = isClassic(state);
  if (classic && state.entry.cursor.path.length > 0) {
    const advanced = E.advanceFractionSlot(state.entry);
    if (advanced !== state.entry) return copy(state, { entry: advanced, historyCursor: null });
  }
  return typeInto(state, (e) => E.startFraction(e, { mixed, classic }));
}

/**
 * `x10ⁿ` (spec 7). eos.js has a `sci` node, but it wants the mantissa and
 * exponent as literal strings, which does not fit an editor where either part
 * can still be typed into. Entering the arithmetically identical `x 10 ^ n`
 * keeps everything editable and evaluates the same.
 */
function pressEE(state) {
  return typeInto(state, (e) => {
    let out = E.insertNode(e, { t: 'op', v: '*' });
    out = E.insertNode(out, { t: 'num', v: '10' });
    return E.insertNode(out, { t: 'pow', exp: [] });
  });
}

/** Repeated presses cycle through x y z t a b c (spec 5.7). */
function pressVar(state) {
  const next = (state.varCycleIndex + 1) % VAR_CYCLE.length;
  const name = VAR_CYCLE[next];

  // Replace the variable inserted by the immediately preceding press.
  const entry = state.varCycleIndex >= 0
    ? E.insertNode(E.backspace(state.entry), { t: 'var', v: name })
    : E.insertNode(state.entry, { t: 'var', v: name });

  return copy(state, { entry, varCycleIndex: next, historyCursor: null });
}

/* ------------------------------------------------------------------ enter - */

function pressEnter(state) {
  // Pasting a previous entry back onto the entry line (spec 2.3).
  if (state.historyCursor != null) {
    const line = historyLines(state)[state.historyCursor];
    if (!line) return copy(state, { historyCursor: null });

    if (line.kind === 'entry' && line.item.kind === 'calc') {
      return copy(state, { entry: entryFromNodes(line.item.nodes), historyCursor: null });
    }
    // Highlighting an answer and pressing enter pastes that value.
    if (line.item.value != null) {
      return copy(state, {
        entry: E.insertNode(E.emptyEntry(), valueNode(line.item.value)),
        historyCursor: null,
      });
    }
    return copy(state, { historyCursor: null });
  }

  if (state.setOpTarget) {
    return copy(state, {
      op: { ...state.op, [state.setOpTarget]: E.toNodes(state.entry) },
      opCount: { ...state.opCount, [state.setOpTarget]: 0 },
      setOpTarget: null,
      entry: E.emptyEntry(),
    });
  }

  if (state.pendingSto) return storeToVariable(state);
  if (E.isEmpty(state.entry)) return state;

  const nodes = E.toNodes(state.entry);
  const value = evaluate(nodes, evalContext(state));

  return copy(state, {
    history: [...state.history, { kind: 'calc', nodes, value }],
    ans: value,
    entry: E.emptyEntry(),
    historyCursor: null,
  });
}

/** Rebuild an editable entry from stored nodes, cursor at the end. */
function entryFromNodes(nodes) {
  const entry = E.emptyEntry();
  return {
    ...entry,
    nodes: structuredClone(nodes),
    cursor: { path: [], offset: nodes.length },
  };
}

/** `value sto► <var> enter` (spec 5.7). */
function storeToVariable(state) {
  const nodes = E.toNodes(state.entry);
  const target = [...nodes].reverse().find((n) => n.t === 'var');
  if (!target) return copy(state, { pendingSto: false });

  const expr = nodes.slice(0, nodes.findIndex((n) => n === target));
  const value = expr.length ? evaluate(expr, evalContext(state)) : state.ans;
  if (value == null) return copy(state, { pendingSto: false });

  return copy(state, {
    vars: { ...state.vars, [target.v]: value },
    ans: value,
    history: [...state.history, { kind: 'calc', nodes, value }],
    entry: E.emptyEntry(),
    pendingSto: false,
  });
}

/* ------------------------------------------------------------------ clear - */

function pressClear(state) {
  if (state.menu) return copy(state, { menu: M.popMenu(state.menu) });

  // `clear` on a highlighted history entry deletes it (spec 2.3).
  if (state.historyCursor != null) {
    const line = historyLines(state)[state.historyCursor];
    const history = line ? state.history.filter((_, i) => i !== line.index) : state.history;
    return copy(state, { history, historyCursor: null });
  }

  if (!E.isEmpty(state.entry)) return copy(state, { entry: E.clearEntry(state.entry) });
  return copy(state, { history: [] });
}

/* ---------------------------------------------------------------- history - */

/**
 * History as the display shows it: each calculation occupies TWO lines, the
 * entry and its answer, and the up-arrow highlight steps through *lines*, not
 * calculations.
 *
 * This is what makes the guidebook's worked example come out right (spec
 * 2.3): with 1+1, 2+2, 3+3, 4+4 entered, four presses of UP land on the entry
 * `3+3` — live line -> answer(4+4) -> entry(4+4) -> answer(3+3) -> entry(3+3).
 * Stepping per calculation instead would land on 1+1.
 */
function historyLines(state) {
  const out = [];
  state.history.forEach((item, index) => {
    out.push({ kind: 'entry', index, item });
    out.push({ kind: 'answer', index, item });
  });
  return out;
}


function verticalKey(state, keyId) {
  // Inside a stacked structure the arrows move the cursor, not the history.
  if (state.entry.cursor.path.length > 0) {
    const moved = E.moveCursor(state.entry, keyId);
    if (moved !== state.entry) return copy(state, { entry: moved });
  }
  return scrollHistory(state, keyId === 'up' ? -1 : +1);
}

function scrollHistory(state, delta) {
  const lines = historyLines(state);
  if (lines.length === 0) return state;

  let cursor = state.historyCursor;
  if (cursor == null) {
    if (delta > 0) return state;          // already below the last entry
    cursor = lines.length - 1;            // first UP -> the bottom history line
  } else {
    cursor += delta;
  }

  if (cursor < 0) cursor = 0;
  if (cursor >= lines.length) return copy(state, { historyCursor: null });
  return copy(state, { historyCursor: cursor });
}

function jumpHistory(state, where) {
  if (state.history.length === 0) return state;
  if (where === 'oldest') {
    // 2nd UP steps to the previous entry, and again to the oldest (spec 2.3).
    const lines = historyLines(state);
    const cursor = state.historyCursor == null ? lines.length - 1 : 0;
    return copy(state, { historyCursor: cursor });
  }
  return state;
}

/* ----------------------------------------------------------------- toggle - */

/**
 * `◄►` (spec 5.4): switch the last answer between exact and decimal, adding a
 * NEW history line showing the original with a `◄►` marker.
 */
function pressToggle(state) {
  if (state.ans == null) return state;
  const last = state.history[state.history.length - 1];
  const wasDecimal = last && last.kind === 'toggle' && last.decimal;

  return copy(state, {
    history: [...state.history, { kind: 'toggle', from: state.ans, value: state.ans, decimal: !wasDecimal }],
    historyCursor: null,
  });
}

/* ------------------------------------------------------------------- simp - */

/**
 * `►simp` (spec 5.5). With a number on the entry line it divides by that
 * factor; on its own it divides by the lowest common prime factor.
 */
function pressSimp(state) {
  if (state.ans == null || !isExact(state.ans)) throw new CalcError('DOMAIN');

  let value;
  if (!E.isEmpty(state.entry)) {
    const by = evaluate(E.toNodes(state.entry), evalContext(state));
    value = simpBy(state.ans, BigInt(Math.trunc(toNumber(by))));
  } else {
    const k = lowestPrimeFactor(state.ans);
    value = k && k > 1n ? simpBy(state.ans, k) : reduce(state.ans);
  }

  return copy(state, {
    history: [...state.history, { kind: 'calc', nodes: E.toNodes(state.entry), value }],
    ans: value,
    entry: E.emptyEntry(),
  });
}

/* --------------------------------------------------------------------- op - */

/**
 * Stored operations (spec 5.13): `op1` recalls and evaluates immediately
 * against the current value, with no `enter`, and shows a repetition counter.
 */
function pressOp(state, which) {
  const opNodes = state.op[which];
  if (!opNodes) throw new CalcError('OP NOT DEFINED');

  const lead = E.isEmpty(state.entry) ? [{ t: 'ans' }] : E.toNodes(state.entry);
  const value = evaluate([...lead, ...opNodes], evalContext(state));
  const count = state.opCount[which] + 1;

  return copy(state, {
    history: [...state.history, { kind: 'calc', nodes: [...lead, ...opNodes], value, opCount: count }],
    ans: value,
    entry: E.emptyEntry(),
    opCount: { ...state.opCount, [which]: count },
  });
}

/* -------------------------------------------------------------------------- */
/* render                                                                      */
/* -------------------------------------------------------------------------- */

const text = (s) => ({ t: 'text', text: s });

/**
 * Where the cursor goes, marked in the content itself.
 *
 * The cursor sits at a position in the entry *tree*, but the display is a
 * rendered Layout — and inside a MathPrint fraction there is no single
 * "column" to point at. Rather than have the renderer and the engine both
 * reimplement the same flattening (and drift apart), the engine splices this
 * marker character in at the cursor position and the renderer swaps it for
 * the cursor element wherever it lands. It is carried on the DisplayModel as
 * `cursor.marker` so the UI never has to import anything from the engine.
 */
const CURSOR_MARK = '\u0000';


function valueNode(value) {
  // Paste a stored value back as a literal the editor can handle.
  return { t: 'num', v: String(toNumber(value)) };
}

/** @returns {object} a DisplayModel (see docs/ARCHITECTURE.md) */
export function render(state) {
  const mode = state.mode;
  const lines = [];

  let lineIndex = 0;
  state.history.forEach((item) => {
    const entryLineIndex = lineIndex++;
    const answerLineIndex = lineIndex++;
    const highlighted = state.historyCursor === entryLineIndex;
    const answerHighlighted = state.historyCursor === answerLineIndex;
    if (item.kind === 'toggle') {
      lines.push({
        layout: { t: 'row', items: [F.formatValue(item.from, mode), text('◄►')] },
        align: 'left',
        highlighted,
      });
      lines.push({
        layout: item.decimal ? F.formatDecimal(item.value, mode) : F.formatValue(item.value, mode),
        align: 'right',
        highlighted: answerHighlighted,
      });
      return;
    }
    lines.push({ layout: F.formatEntry(item.nodes, mode), align: 'left', highlighted });
    const answer = F.formatValue(item.value, mode);
    lines.push({
      layout: item.opCount
        ? { t: 'row', items: [text(`n=${item.opCount}  `), answer] }
        : answer,
      align: 'right',
      highlighted: answerHighlighted,
    });
  });

  // The live entry line, unless a previous entry is highlighted.
  if (state.historyCursor == null) {
    lines.push({
      layout: F.formatEntry(E.toNodesWithMarker(state.entry, CURSOR_MARK), mode),
      align: 'left',
      current: true,
    });
  }

  return {
    lines,
    indicators: {
      second: state.second,
      fix: mode.decimals !== 'FLOAT',
      sci: mode.notation === 'SCI',
      deg: mode.angle === 'DEG',
      rad: mode.angle === 'RAD',
      L1: false, L2: false, L3: false,
      busy: false,
      scrollUp: lines.length > MAX_LINES,
      scrollDown: state.historyCursor != null,
      scrollLeft: false,
      scrollRight: false,
    },
    cursor: state.historyCursor == null && !state.error
      ? {
        line: Math.max(0, lines.length - 1),
        marker: CURSOR_MARK,
        style: state.entry.insertMode ? 'underline' : 'block',
      }
      : null,
    error: state.error,
    menu: state.menu ? M.toMenuModel(state.menu) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Known gaps — see PROJECT_STATE.md "Known divergences"                       */
/*                                                                             */
/* - The `data` editor (spec 6.1) opens its menu but cell editing and list     */
/*   conversions are not implemented, so 1-Var/2-Var stats cannot be run from  */
/*   the keypad yet. stats.js itself is complete and tested.                   */
/* - `2nd [,]`, and therefore the two-argument forms of round/lcm/gcd/min/max  */
/*   /remainder/randint, are not wired.                                        */
/* -------------------------------------------------------------------------- */
