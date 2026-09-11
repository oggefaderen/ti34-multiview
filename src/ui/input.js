// TI-34 MultiView — input wiring: clicks + physical keyboard -> key ids.
//
// This module never imports calculator.js (see docs/ARCHITECTURE.md's
// layering rule): it only knows tokens.js's key ids and calls back into
// `onKey(keyId)`. All calculator meaning lives below this layer.
//
// Keyboard mapping mirrors README.md's table exactly — see the two maps
// below. Keep them in agreement if either changes.

import { isKey } from '../engine/tokens.js';

const PRESS_MS = 100;

// ---------------------------------------------------------------------
// README.md keyboard map
// ---------------------------------------------------------------------
//
// Most physical keys correspond to exactly one key id. A few correspond to
// a *function* that isn't a key id of its own (sin, cos, log, ans, ...) —
// those are reached on the real faceplate via a short sequence of physical
// key presses (2nd, then a key, then a menu-item digit), so here they are
// dispatched as the equivalent sequence of onKey calls, exactly as if the
// keys had been struck in order. See the implementation report for the
// specific sequences chosen (spec 4.4/4.5 menu layouts).
//
// NOTE on `+ - * /`: these map to the arithmetic key of the SAME meaning --
// '+' is addition, '/' is division. An earlier version read README.md's
// table positionally (its right-hand column listed the operators in the
// calculator's physical top-to-bottom column order) and wired '+' to
// divide. The table has since been split into one row per key so it cannot
// be misread that way again.

export const DIRECT_KEY_MAP = {
  '0': 'd0', '1': 'd1', '2': 'd2', '3': 'd3', '4': 'd4',
  '5': 'd5', '6': 'd6', '7': 'd7', '8': 'd8', '9': 'd9',
  '.': 'dot',
  '(': 'lparen', ')': 'rparen',
  Enter: 'enter', '=': 'enter',
  Backspace: 'delete',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Tab: 'second',
  '\\': 'toggle',
  '^': 'pow',
  r: 'sqrt',
  q: 'square',
  p: 'pi',
  e: 'ee',
  f: 'ndiv',
  F: 'undiv',
  '%': 'percent',
  m: 'mode',
  v: 'var',
  x: 'sto',
  // scrambled arithmetic row — see NOTE above
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
};

// Keys reached by holding "2nd" and pressing a menu-opening key, then
// picking a numbered item directly (spec 4.1: item numbers select without
// a separate `enter`).
export const MACRO_KEY_MAP = {
  s: ['second', 'pi', 'd1'], // sin(       — 2nd [trig], item 1
  c: ['second', 'pi', 'd2'], // cos(       — 2nd [trig], item 2
  t: ['second', 'pi', 'd3'], // tan(       — 2nd [trig], item 3
  S: ['second', 'pi', 'd4'], // sin⁻¹(     — 2nd [trig], item 4
  C: ['second', 'pi', 'd5'], // cos⁻¹(     — 2nd [trig], item 5
  T: ['second', 'pi', 'd6'], // tan⁻¹(     — 2nd [trig], item 6
  l: ['second', 'prb', 'd1'], // log(       — 2nd [log], LOG tab, item 1
  n: ['second', 'prb', 'right', 'd1'], // ln( — 2nd [log], LN tab, item 1
  a: ['second', 'neg'], // ans        — 2nd [(-)]
};

// ---------------------------------------------------------------------
// Faceplate flash (".pressed") — teaches the layout while typing.
// ---------------------------------------------------------------------

function makeFlash(root) {
  const timers = new Map();
  return function flash(keyId) {
    let selector;
    try {
      selector = `[data-key="${CSS.escape(keyId)}"]`;
    } catch {
      selector = `[data-key="${keyId}"]`;
    }
    const btn = root.querySelector(selector);
    if (!btn) return;
    btn.classList.add('pressed');
    const prev = timers.get(keyId);
    if (prev) clearTimeout(prev);
    timers.set(
      keyId,
      setTimeout(() => {
        btn.classList.remove('pressed');
        timers.delete(keyId);
      }, PRESS_MS)
    );
  };
}

// ---------------------------------------------------------------------
// Help overlay
// ---------------------------------------------------------------------

function makeHelp(root) {
  const panel = root.querySelector('#keymap-help');
  return {
    isOpen: () => !!panel && !panel.hidden,
    open: () => { if (panel) panel.hidden = false; },
    close: () => { if (panel) panel.hidden = true; },
    toggle: () => { if (panel) panel.hidden = !panel.hidden; },
  };
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Wire clicks and the physical keyboard to `onKey(keyId)`. Never imports
 * calculator.js — the UI layer stays free of calculator semantics.
 *
 * @param {{onKey: (keyId: string) => void}} handlers
 * @param {{root?: Document|Element, win?: Window}} [options]
 * @returns {{detach: () => void}}
 */
export function attachInput({ onKey }, { root = document, win = globalThis.window } = {}) {
  const flash = makeFlash(root);
  const help = makeHelp(root);

  function dispatch(ids) {
    for (const id of ids) {
      flash(id);
      onKey(id);
    }
  }

  function onClick(e) {
    const btn = e.target.closest && e.target.closest('[data-key]');
    if (!btn) return;
    const id = btn.dataset.key;
    if (!isKey(id)) return;
    dispatch([id]);
  }

  function onHelpToggleClick() {
    help.toggle();
  }

  function onKeyDown(e) {
    // Let OS/browser shortcuts (Cmd+Q, Ctrl+R, ...) through untouched.
    if (e.metaKey || e.ctrlKey) return;

    if (e.key === '?') {
      e.preventDefault();
      help.toggle();
      return;
    }

    if (help.isOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        help.close();
      } else {
        // A modal is up; don't let keys leak through to the calculator
        // or to the page (e.g. Space scrolling behind the overlay).
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      dispatch(['clear']);
      return;
    }

    if (e.code === 'Space') {
      // No calculator function is bound to Space; just stop page scroll.
      e.preventDefault();
      return;
    }

    const macro = MACRO_KEY_MAP[e.key];
    if (macro) {
      e.preventDefault();
      dispatch(macro);
      return;
    }

    const direct = DIRECT_KEY_MAP[e.key];
    if (direct) {
      e.preventDefault();
      dispatch([direct]);
      return;
    }

    // Unmapped key (e.g. a bare letter with no calculator meaning) — leave
    // default browser behaviour alone.
  }

  root.addEventListener('click', onClick);
  const helpToggleBtn = root.querySelector('#help-toggle');
  if (helpToggleBtn) helpToggleBtn.addEventListener('click', onHelpToggleClick);
  if (win) win.addEventListener('keydown', onKeyDown);

  return {
    detach() {
      root.removeEventListener('click', onClick);
      if (helpToggleBtn) helpToggleBtn.removeEventListener('click', onHelpToggleClick);
      if (win) win.removeEventListener('keydown', onKeyDown);
    },
  };
}
