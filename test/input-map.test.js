// Keyboard mapping regression tests.
//
// A wrong key mapping is silent: the app looks fine, and you only discover
// that "+" divides when you are halfway through a problem. An earlier version
// really did map + - * / to divide/multiply/subtract/add, because README's
// table listed the operators in the calculator's physical column order and
// that was read as a positional correspondence. These tests pin the mapping
// so it cannot drift again.
//
// input.js touches the DOM only inside attachInput(), so importing it here is
// safe without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DIRECT_KEY_MAP, MACRO_KEY_MAP } from '../src/ui/input.js';
import { KEY_BY_ID } from '../src/engine/tokens.js';

test('arithmetic keys map to the operator of the same meaning', () => {
  assert.equal(DIRECT_KEY_MAP['+'], 'add');
  assert.equal(DIRECT_KEY_MAP['-'], 'sub');
  assert.equal(DIRECT_KEY_MAP['*'], 'mul');
  assert.equal(DIRECT_KEY_MAP['/'], 'div');
});

test('digits map to their own digit keys', () => {
  for (let d = 0; d <= 9; d++) {
    assert.equal(DIRECT_KEY_MAP[String(d)], `d${d}`, `digit ${d}`);
  }
});

test('editing and navigation keys map as documented in README', () => {
  assert.equal(DIRECT_KEY_MAP.Enter, 'enter');
  assert.equal(DIRECT_KEY_MAP['='], 'enter');
  assert.equal(DIRECT_KEY_MAP.Backspace, 'delete');
  assert.equal(DIRECT_KEY_MAP.Tab, 'second');
  assert.equal(DIRECT_KEY_MAP['\\'], 'toggle');
  assert.equal(DIRECT_KEY_MAP.ArrowUp, 'up');
  assert.equal(DIRECT_KEY_MAP.ArrowDown, 'down');
  assert.equal(DIRECT_KEY_MAP.ArrowLeft, 'left');
  assert.equal(DIRECT_KEY_MAP.ArrowRight, 'right');
});

test('Escape is handled outside the table, because it is overloaded', () => {
  // Escape closes the keyboard-help overlay when it is open and otherwise
  // acts as `clear`, so it cannot be a plain table entry. Verified live in a
  // browser; asserted here only as intent, so that moving it into the table
  // without preserving the overlay behaviour shows up as a failure.
  assert.ok(!('Escape' in DIRECT_KEY_MAP),
    'Escape must stay special-cased so it can also dismiss the help overlay');
});

test('every mapped id is a real key on the faceplate', () => {
  for (const [k, id] of Object.entries(DIRECT_KEY_MAP)) {
    assert.ok(KEY_BY_ID.has(id), `"${k}" -> unknown key id "${id}"`);
  }
  for (const [k, seq] of Object.entries(MACRO_KEY_MAP)) {
    assert.ok(Array.isArray(seq), `"${k}" should map to a sequence`);
    for (const id of seq) {
      assert.ok(KEY_BY_ID.has(id), `"${k}" -> unknown key id "${id}"`);
    }
  }
});

test('trig macros go through the 2nd [trig] menu, in spec 4.5 order', () => {
  // The TI-34 has no dedicated sin/cos/tan keys: they live in a menu opened
  // with 2nd [trig], which is the 2nd layer of the pi key (spec 1, 4.5).
  assert.deepEqual(MACRO_KEY_MAP.s, ['second', 'pi', 'd1']);
  assert.deepEqual(MACRO_KEY_MAP.c, ['second', 'pi', 'd2']);
  assert.deepEqual(MACRO_KEY_MAP.t, ['second', 'pi', 'd3']);
  assert.deepEqual(MACRO_KEY_MAP.S, ['second', 'pi', 'd4']);
  assert.deepEqual(MACRO_KEY_MAP.C, ['second', 'pi', 'd5']);
  assert.deepEqual(MACRO_KEY_MAP.T, ['second', 'pi', 'd6']);
});

test('no key is both a direct mapping and a macro', () => {
  for (const k of Object.keys(MACRO_KEY_MAP)) {
    assert.ok(!(k in DIRECT_KEY_MAP), `"${k}" is mapped twice`);
  }
});

/* -------------------------------------------------------------------------- */
/* Regression: inverse video must not resolve against its own colour           */
/* -------------------------------------------------------------------------- */

test('the renderer never paints a background with currentColor', async () => {
  // `background: currentColor` resolves against the element's OWN `color`.
  // The menu highlight set both in one rule, so the selected row painted its
  // text and background the same colour and became invisible — the menu
  // looked like it was missing its first item. Inverse video must state both
  // colours explicitly.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  assert.ok(
    !/background\s*:\s*currentColor/i.test(src),
    'use explicit colours for inverse video, not currentColor',
  );
});
