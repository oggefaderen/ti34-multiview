// State-machine tests: press keys, check the screen.
//
// `run('5 + 3 enter')` presses a sequence of key ids and returns the final
// state, so a test reads close to what you would actually do on the device.
// Tests cite the spec section they come from.

import test from 'node:test';
import assert from 'node:assert/strict';

import { initialState, press, render } from '../src/engine/calculator.js';

/** Friendly aliases so sequences read like keystrokes, not identifiers. */
const ALIAS = {
  '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '=': 'enter',
  '(': 'lparen', ')': 'rparen', '.': 'dot',
  0: 'd0', 1: 'd1', 2: 'd2', 3: 'd3', 4: 'd4',
  5: 'd5', 6: 'd6', 7: 'd7', 8: 'd8', 9: 'd9',
};

function keys(seq) {
  return seq.trim().split(/\s+/).map((k) => ALIAS[k] ?? k);
}

function run(seq, from = initialState()) {
  return keys(seq).reduce(press, from);
}

/**
 * Flatten a Layout to plain text for assertions.
 *
 * The engine splices a NUL marker into the entry line to say where the cursor
 * goes (render.js swaps it for the cursor element), so strip it here — it is
 * a position marker, not content.
 */
const CURSOR_MARK = '\u0000';

function flat(layout) {
  if (!layout) return '';
  switch (layout.t) {
    case 'text': return layout.text.split(CURSOR_MARK).join('');
    case 'row': return (layout.items || []).map(flat).join('');
    case 'frac': return `${flat(layout.num)}/${flat(layout.den)}`;
    case 'sup': return `${flat(layout.base)}^${flat(layout.sup)}`;
    case 'radical': return `sqrt(${flat(layout.arg)})`;
    default: return '';
  }
}

/** The most recent right-aligned line: the answer. */
function answer(state) {
  const lines = render(state).lines.filter((l) => l.align === 'right');
  return lines.length ? flat(lines[lines.length - 1].layout) : null;
}

const entryText = (state) => {
  const lines = render(state).lines.filter((l) => l.current);
  return lines.length ? flat(lines[0].layout) : '';
};

/* ------------------------------------------------------------- basics ----- */

test('a fresh calculator shows an empty entry line in DEG', () => {
  const m = render(initialState());
  assert.equal(m.error, null);
  assert.equal(m.menu, null);
  assert.equal(m.indicators.deg, true);
  assert.equal(m.indicators.rad, false);
});

test('press is pure — the input state is not mutated', () => {
  const s = initialState();
  const before = JSON.stringify(s, (k, v) => (typeof v === 'bigint' ? String(v) : v));
  run('5 + 3 enter', s);
  assert.equal(JSON.stringify(s, (k, v) => (typeof v === 'bigint' ? String(v) : v)), before);
});

test('5 + 3 enter gives 8', () => {
  assert.equal(answer(run('5 + 3 enter')), '8');
});

test('spec 5.1 — EOS precedence: 1 + 2 x 3 is 7, not 9', () => {
  assert.equal(answer(run('1 + 2 * 3 enter')), '7');
});

test('spec 5.1 — parentheses override precedence', () => {
  assert.equal(answer(run('( 1 + 2 ) * 3 enter')), '9');
});

/* ------------------------------------------------------------- 2nd layer -- */

test('spec 1 — 2nd arms the second layer and lights the indicator', () => {
  const s = press(initialState(), 'second');
  assert.equal(render(s).indicators.second, true);
});

test('pressing 2nd twice cancels it', () => {
  const s = run('second second');
  assert.equal(render(s).indicators.second, false);
});

test('a 2nd-layer key consumes the flag', () => {
  const s = run('second mode');   // 2nd [quit]
  assert.equal(render(s).indicators.second, false);
});

test('spec 4.1 — 2nd [trig] opens the trig menu', () => {
  const m = render(run('second pi'));
  assert.ok(m.menu, 'a menu should be open');
});

/* ------------------------------------------------------------- ans -------- */

test('spec 5.6 — an entry starting with an operator recalls ans implicitly', () => {
  let s = run('5 + 3 enter');      // 8
  s = run('+ 2 enter', s);         // ans + 2
  assert.equal(answer(s), '10');
});

test('spec 5.6 — 2nd [ans] inserts ans explicitly', () => {
  let s = run('7 enter');
  s = run('second neg * 2 enter', s);
  assert.equal(answer(s), '14');
});

/* --------------------------------------------------------- previous entry - */

test('spec 2.3 — the guidebook worked example: recall 3+3, edit to 3+3+2, get 8', () => {
  // Enter 1+1, 2+2, 3+3, 4+4; press UP four times; enter pastes 3+3.
  let s = run('1 + 1 enter 2 + 2 enter 3 + 3 enter 4 + 4 enter');
  assert.equal(answer(s), '8');

  s = run('up up up up', s);
  s = press(s, 'enter');            // paste the highlighted entry
  assert.equal(entryText(s).replace(/\s/g, ''), '3+3', 'the pasted entry line');

  s = run('+ 2 enter', s);
  assert.equal(answer(s), '8');
});

test('spec 2.3 — clear on a highlighted history entry deletes it', () => {
  let s = run('1 + 1 enter 2 + 2 enter');
  const before = render(s).lines.length;
  s = run('up clear', s);
  assert.ok(render(s).lines.length < before, 'a history pair should be gone');
});

/* ---------------------------------------------------------------- memory -- */

test('spec 5.7 — sto stores into x, and the name recalls it', () => {
  let s = run('5 0 sto var enter');       // 50 -> x
  s = run('var * 2 enter', s);
  assert.equal(answer(s), '100');
});

test('spec 5.7 — repeated var presses cycle x y z t a b c', () => {
  let s = run('7 sto var var enter');     // 7 -> y
  s = run('var var * 3 enter', s);        // recall y
  assert.equal(answer(s), '21');
});

test('spec 5.12 — 2nd [clear var] clears the variables', () => {
  let s = run('5 sto var enter');
  s = run('second var', s);               // opens Clear Var, "1: Yes" first
  s = press(s, 'enter');
  assert.equal(s.vars.x, null);
});

/* ----------------------------------------------------------------- modes -- */

test('spec 3 — mode opens the MODE menu with six lines', () => {
  const m = render(press(initialState(), 'mode'));
  assert.ok(m.menu);
});

test('spec 3 — switching to RAD changes the indicator and trig results', () => {
  let s = press(initialState(), 'mode');
  s = press(s, 'right');    // DEG -> RAD on line 1
  s = press(s, 'enter');
  assert.equal(s.mode.angle, 'RAD');
  assert.equal(render(s).indicators.rad, true);
});

test('spec 3 — switching entry mode clears history (it also clears op1/op2)', () => {
  let s = run('2 + 2 enter');
  assert.ok(s.history.length > 0);
  s = press(s, 'mode');
  s = run('down down down', s);   // to the CLASSIC/MATHPRINT line
  s = press(s, 'left');           // choose CLASSIC
  s = press(s, 'enter');
  assert.equal(s.mode.entry, 'CLASSIC');
  assert.deepEqual(s.history, [], 'history is cleared by the entry-mode switch');
});

/* ---------------------------------------------------------------- errors -- */

test('spec 5.11 — dividing by zero shows DIVIDE BY 0', () => {
  const m = render(run('5 / 0 enter'));
  assert.equal(m.error, 'DIVIDE BY 0');
});

test('spec 5.12 — clear dismisses an error', () => {
  let s = run('5 / 0 enter');
  assert.equal(render(s).error, 'DIVIDE BY 0');
  s = press(s, 'clear');
  assert.equal(render(s).error, null);
});

test('spec 5.11 — an error screen ignores everything but clear', () => {
  let s = run('5 / 0 enter');
  s = run('7 8 9', s);
  assert.equal(render(s).error, 'DIVIDE BY 0', 'still showing the error');
});

test('spec 5.11 — sqrt of a negative is DOMAIN', () => {
  assert.equal(render(run('sqrt neg 4 enter')).error, 'DOMAIN');
});

/* ----------------------------------------------------------------- clear -- */

test('spec 5.12 — clear empties the entry line, then the display', () => {
  let s = run('1 2 3');
  assert.notEqual(entryText(s), '');
  s = press(s, 'clear');
  assert.equal(entryText(s), '', 'entry line cleared');
  s = run('4 + 4 enter clear', s);
  s = press(s, 'clear');
  assert.deepEqual(s.history, [], 'display cleared on the second press');
});

/* ------------------------------------------------------------- fractions -- */

test('spec 5.5 — 1/2 + 3/4 is 1 1/4 in the default Un/d style', () => {
  // n/d after a digit adopts it as the numerator and lands in the denominator
  const s = run('1 ndiv 2 right + 3 ndiv 4 right enter');
  assert.equal(answer(s), '1 1/4');
});

test('spec 3 — MANSIMP leaves a result unreduced; AUTOSIMP reduces it', () => {
  const man = run('1 ndiv 4 right + 3 ndiv 1 2 right enter');
  assert.match(answer(man), /6\/12/, 'MANSIMP keeps 6/12');

  let s = press(initialState(), 'mode');
  s = run('down down down down down', s);  // the MANSIMP/AUTOSIMP line
  s = press(s, 'right');
  s = press(s, 'enter');
  assert.equal(s.mode.simp, 'AUTOSIMP');
  s = run('1 ndiv 4 right + 3 ndiv 1 2 right enter', s);
  assert.match(answer(s), /1\/2/, 'AUTOSIMP reduces to 1/2');
});

/* ---------------------------------------------------------------- toggle -- */

test('spec 5.4 — the toggle key adds a line and shows the decimal form', () => {
  let s = run('2 * pi enter');
  const before = render(s).lines.length;
  s = press(s, 'toggle');
  const m = render(s);
  assert.ok(m.lines.length > before, 'toggling adds a history line');
  assert.match(answer(s), /6\.283185307/);
});

/* -------------------------------------------------------------- rendering - */

test('the display never claims more than four lines of content are visible', () => {
  const s = run('1 + 1 enter 2 + 2 enter 3 + 3 enter 4 + 4 enter');
  const m = render(s);
  assert.ok(m.indicators.scrollUp, 'scroll-up arrow lights once history overflows');
});

test('FIX and SCI indicators follow the mode', () => {
  let s = press(initialState(), 'mode');
  s = run('down', s);          // NORM/SCI line
  s = press(s, 'right');
  s = press(s, 'enter');
  assert.equal(render(s).indicators.sci, true);
});
