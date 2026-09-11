// Entry-line editing tests.
//
// The round-trip against eos.js is the real contract: whatever entry.js
// builds must evaluate without translation. Tests cite the spec section they
// come from.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyEntry, insertNode, insertDigit, startFraction, advanceFractionSlot,
  backspace, clearEntry, moveCursor, isEmpty, nodeCount, entryLength,
  toNodes, setInsertMode, MAX_ENTRY_LENGTH,
} from '../src/engine/entry.js';
import { evaluate } from '../src/engine/eos.js';
import { toNumber, CalcError } from '../src/engine/value.js';

const CTX = {
  angle: 'DEG', classic: false, vars: {}, ans: null, stats: null, randSeed: 1n,
};
const evalEntry = (entry, over = {}) => toNumber(evaluate(toNodes(entry), { ...CTX, ...over }));
const digits = (entry, str) => [...str].reduce((e, ch) => insertDigit(e, ch), entry);

test('a fresh entry is empty', () => {
  const e = emptyEntry();
  assert.ok(isEmpty(e));
  assert.equal(nodeCount(e), 0);
});

test('consecutive digits build a single number node', () => {
  const e = digits(emptyEntry(), '325');
  assert.equal(nodeCount(e), 1);
  assert.deepEqual(toNodes(e)[0], { t: 'num', v: '325' });
});

test('a number takes only one decimal point', () => {
  const e = digits(emptyEntry(), '3.2.5');
  assert.deepEqual(toNodes(e)[0], { t: 'num', v: '3.25' });
});

test('editing is pure — the input entry is never mutated', () => {
  const a = digits(emptyEntry(), '12');
  const before = JSON.stringify(a);
  insertDigit(a, '3');
  backspace(a);
  moveCursor(a, 'left');
  assert.equal(JSON.stringify(a), before);
});

test('round-trip: 5 + 3 evaluates through eos.js', () => {
  let e = digits(emptyEntry(), '5');
  e = insertNode(e, { t: 'op', v: '+' });
  e = digits(e, '3');
  assert.equal(evalEntry(e), 8);
});

test('spec 5.3 — (-) is a negation node, never a binary minus', () => {
  let e = insertNode(emptyEntry(), { t: 'neg' });
  e = digits(e, '3');
  assert.deepEqual(toNodes(e)[0], { t: 'neg' });
  assert.equal(evalEntry(e), -3);
});

test('spec 5.3 — negation sits below exponentiation: (-)3 x2 is -9', () => {
  let e = insertNode(emptyEntry(), { t: 'neg' });
  e = digits(e, '3');
  e = insertNode(e, { t: 'postfix', v: 'square' });
  assert.equal(evalEntry(e), -9);
});

/* ---------------------------------------------------------------- fractions */

test('spec 5.5 — n/d after a number adopts it as the numerator', () => {
  let e = digits(emptyEntry(), '3');
  e = startFraction(e);
  const frac = toNodes(e)[0];
  assert.equal(frac.t, 'frac');
  assert.deepEqual(frac.num, [{ t: 'num', v: '3' }]);
  // ...and the cursor lands in the denominator, ready to type.
  e = digits(e, '4');
  assert.deepEqual(toNodes(e)[0].den, [{ t: 'num', v: '4' }]);
  assert.equal(evalEntry(e), 0.75);
});

test('spec 5.5 — n/d on an empty entry lays down an empty template', () => {
  let e = startFraction(emptyEntry());
  const frac = toNodes(e)[0];
  assert.deepEqual(frac.num, []);
  assert.deepEqual(frac.den, []);
  e = digits(e, '1');            // cursor starts in the numerator
  e = moveCursor(e, 'down');     // MathPrint: DOWN moves to the denominator
  e = digits(e, '8');
  assert.equal(evalEntry(e), 0.125);
});

test('spec 5.5 — U n/d builds a mixed number, which is additive not multiplicative', () => {
  let e = digits(emptyEntry(), '4');
  e = startFraction(e, { mixed: true });   // cursor -> numerator
  e = digits(e, '1');
  e = moveCursor(e, 'down');
  e = digits(e, '2');
  assert.equal(toNodes(e)[0].t, 'mixed');
  assert.equal(evalEntry(e), 4.5, '4 1/2 is 4.5, not 2');
});

test('spec 5.5 — in Classic, pressing n/d again advances to the denominator', () => {
  let e = startFraction(emptyEntry(), { classic: true });
  e = digits(e, '1');
  e = advanceFractionSlot(e);
  e = digits(e, '4');
  assert.equal(evalEntry(e, { classic: true }), 0.25);
});

test('spec 5.5 — Classic fractions reject operators inside them', () => {
  let e = startFraction(emptyEntry(), { classic: true });
  e = digits(e, '1');
  assert.throws(
    () => insertNode(e, { t: 'op', v: '+' }, { classic: true }),
    (err) => err instanceof CalcError && err.code === 'SYNTAX',
  );
});

test('spec 5.5 — MathPrint fractions accept operators inside them', () => {
  let e = startFraction(emptyEntry());
  e = digits(e, '1');
  e = insertNode(e, { t: 'op', v: '+' });
  e = digits(e, '2');
  e = moveCursor(e, 'down');
  e = digits(e, '6');
  assert.equal(evalEntry(e), 0.5, '(1+2)/6');
});

/* ------------------------------------------------------------------- cursor */

test('RIGHT walks into a fraction and back out again', () => {
  let e = digits(emptyEntry(), '3');
  e = startFraction(e);
  e = digits(e, '4');
  // cursor is in the denominator; walk out to the top level
  e = moveCursor(e, 'right');
  assert.equal(e.cursor.path.length, 0, 'should have left the fraction');
  e = digits(e, '7');
  assert.equal(toNodes(e).length, 2);
  assert.deepEqual(toNodes(e)[1], { t: 'num', v: '7' });
});

test('LEFT enters a preceding fraction from the right', () => {
  let e = digits(emptyEntry(), '3');
  e = startFraction(e);
  e = digits(e, '4');
  e = moveCursor(e, 'right');   // out of the fraction
  e = moveCursor(e, 'left');    // back into it
  assert.ok(e.cursor.path.length > 0, 'should be inside the fraction again');
});

test('spec 5.5 — UP and DOWN move between numerator and denominator', () => {
  let e = startFraction(emptyEntry());
  e = digits(e, '1');
  assert.equal(e.cursor.path.at(-1).slot, 'num');
  e = moveCursor(e, 'down');
  assert.equal(e.cursor.path.at(-1).slot, 'den');
  e = moveCursor(e, 'up');
  assert.equal(e.cursor.path.at(-1).slot, 'num');
});

test('UP and DOWN do nothing outside a stacked structure', () => {
  const e = digits(emptyEntry(), '5');
  assert.deepEqual(moveCursor(e, 'up'), e);
  assert.deepEqual(moveCursor(e, 'down'), e);
});

/* ---------------------------------------------------------------- deleting  */

test('spec 5.12 — delete removes one digit at a time', () => {
  let e = digits(emptyEntry(), '325');
  e = backspace(e);
  assert.deepEqual(toNodes(e)[0], { t: 'num', v: '32' });
  e = backspace(e);
  e = backspace(e);
  assert.ok(isEmpty(e));
});

test('spec 5.12 — deleting out of a wholly empty fraction removes it', () => {
  let e = startFraction(emptyEntry());
  assert.equal(nodeCount(e), 1);
  e = backspace(e);
  assert.ok(isEmpty(e), 'the empty fraction should be gone');
});

test('deleting out of a partly filled fraction keeps it', () => {
  let e = digits(emptyEntry(), '3');
  e = startFraction(e);          // 3 is now the numerator
  e = backspace(e);              // at the start of the denominator
  assert.equal(toNodes(e)[0].t, 'frac', 'fraction with content survives');
});

test('clear empties the entry', () => {
  const e = clearEntry(digits(emptyEntry(), '999'));
  assert.ok(isEmpty(e));
});

test('spec 5.12 — insert mode is modelled', () => {
  const e = setInsertMode(emptyEntry(), true);
  assert.equal(e.insertMode, true);
  assert.equal(setInsertMode(e, false).insertMode, false);
});

/* ------------------------------------------------------------------- limits */

test('spec 5.11 — more than four nested levels raises MEMORY LIMIT', () => {
  let e = emptyEntry();
  for (let i = 0; i < 4; i++) e = startFraction(e);   // four levels is allowed
  assert.throws(
    () => startFraction(e),
    (err) => err instanceof CalcError && err.code === 'MEMORY LIMIT',
  );
});

test('spec 5.11 — an over-long entry raises EQUATION LENGTH', () => {
  let e = emptyEntry();
  assert.throws(() => {
    for (let i = 0; i < MAX_ENTRY_LENGTH + 10; i++) e = insertDigit(e, '9');
  }, (err) => err instanceof CalcError && err.code === 'EQUATION LENGTH');
  assert.ok(entryLength(e) <= MAX_ENTRY_LENGTH);
});

/* -------------------------------------------------- round-trips against eos */

test('round-trip: nested MathPrint fraction evaluates correctly', () => {
  // (1/2) / 4  built by nesting
  let e = startFraction(emptyEntry());
  e = digits(e, '1');
  e = moveCursor(e, 'down');
  e = digits(e, '2');
  e = moveCursor(e, 'right');          // leave the fraction
  e = insertNode(e, { t: 'op', v: '/' });
  e = digits(e, '4');
  assert.equal(evalEntry(e), 0.125);
});

test('round-trip: containers put the cursor inside, so sqrt fills immediately', () => {
  let e = insertNode(emptyEntry(), { t: 'sqrt', arg: [] });
  e = digits(e, '9');
  assert.equal(evalEntry(e), 3);
});

test('round-trip: parentheses respect EOS precedence', () => {
  // (2+3) x 4 = 20, proving the paren node nests rather than flattening
  let e = insertNode(emptyEntry(), { t: 'paren', arg: [] });
  e = digits(e, '2');
  e = insertNode(e, { t: 'op', v: '+' });
  e = digits(e, '3');
  e = moveCursor(e, 'right');
  e = insertNode(e, { t: 'op', v: '*' });
  e = digits(e, '4');
  assert.equal(evalEntry(e), 20);
});

test('round-trip: implicit multiplication stays loose — 8 / 2 pi', () => {
  // spec 5.2: same precedence as x and /, so this is (8/2)*pi
  let e = digits(emptyEntry(), '8');
  e = insertNode(e, { t: 'op', v: '/' });
  e = digits(e, '2');
  e = insertNode(e, { t: 'const', v: 'pi' });
  assert.ok(Math.abs(evalEntry(e) - 12.56637061) < 1e-6, `got ${evalEntry(e)}`);
});
