// Key table for the TI-34 MultiView.
//
// This is the single source of truth shared by the engine and the UI. The UI
// renders the faceplate straight from KEYS and sends key ids to the engine;
// it knows nothing about what a key means. The engine resolves the 2nd layer
// itself, exactly as the real calculator does.
//
// Grid: 5 columns x 9 rows. The arrow pad is one unit spanning columns 4-5 of
// rows 1-2; its four directions are separate keys positioned within it.
//
// See docs/TI-34-SPEC.md section 1 for the physical layout and colours.

/** @typedef {'white'|'cream'|'blue'|'darkblue'} Face */

/**
 * @typedef {object} Key
 * @property {string}  id      stable identifier, used by engine and UI
 * @property {string}  label   primary legend printed on the key
 * @property {?string} second  2nd-layer legend printed above the key, or null
 * @property {number}  row     1-9
 * @property {number}  col     1-5
 * @property {Face}    face    key colour on the production faceplate
 */

/** @type {Key[]} */
export const KEYS = [
  // row 1
  { id: 'second',  label: '2nd',    second: null,          row: 1, col: 1, face: 'cream' },
  { id: 'mode',    label: 'mode',   second: 'quit',        row: 1, col: 2, face: 'blue' },
  { id: 'delete',  label: 'delete', second: 'insert',      row: 1, col: 3, face: 'blue' },

  // arrow pad — spans cols 4-5 of rows 1-2
  { id: 'up',      label: '▲',      second: null,          row: 1, col: 4, face: 'darkblue' },
  { id: 'left',    label: '◄',      second: null,          row: 1, col: 5, face: 'darkblue' },
  { id: 'right',   label: '►',      second: null,          row: 2, col: 4, face: 'darkblue' },
  { id: 'down',    label: '▼',      second: null,          row: 2, col: 5, face: 'darkblue' },

  // row 2
  { id: 'undiv',   label: 'U n/d',  second: 'n/d◄►U n/d',  row: 2, col: 1, face: 'blue' },
  { id: 'ndiv',    label: 'n/d',    second: 'f◄►d',        row: 2, col: 2, face: 'blue' },
  { id: 'percent', label: '%',      second: '►%',          row: 2, col: 3, face: 'blue' },

  // row 3
  { id: 'simp',    label: '►simp',  second: null,          row: 3, col: 1, face: 'blue' },
  { id: 'math',    label: 'math',   second: 'angle',       row: 3, col: 2, face: 'blue' },
  { id: 'prb',     label: 'prb',    second: 'log',         row: 3, col: 3, face: 'blue' },
  { id: 'data',    label: 'data',   second: 'stat',        row: 3, col: 4, face: 'blue' },
  { id: 'clear',   label: 'clear',  second: null,          row: 3, col: 5, face: 'blue' },

  // row 4
  { id: 'pi',      label: 'π',      second: 'trig',        row: 4, col: 1, face: 'blue' },
  { id: 'ee',      label: '×10ⁿ',   second: '1/x',         row: 4, col: 2, face: 'blue' },
  { id: 'op1',     label: 'op1',    second: 'set op1',     row: 4, col: 3, face: 'blue' },
  { id: 'op2',     label: 'op2',    second: 'set op2',     row: 4, col: 4, face: 'blue' },
  { id: 'div',     label: '÷',      second: 'int÷',        row: 4, col: 5, face: 'darkblue' },

  // row 5
  { id: 'square',  label: 'x²',     second: null,          row: 5, col: 1, face: 'blue' },
  { id: 'sqrt',    label: '√',      second: null,          row: 5, col: 2, face: 'blue' },
  { id: 'lparen',  label: '(',      second: null,          row: 5, col: 3, face: 'blue' },
  { id: 'rparen',  label: ')',      second: null,          row: 5, col: 4, face: 'blue' },
  { id: 'mul',     label: '×',      second: null,          row: 5, col: 5, face: 'darkblue' },

  // row 6
  { id: 'pow',     label: '^',      second: 'ˣ√',          row: 6, col: 1, face: 'blue' },
  { id: 'd7',      label: '7',      second: null,          row: 6, col: 2, face: 'white' },
  { id: 'd8',      label: '8',      second: null,          row: 6, col: 3, face: 'white' },
  { id: 'd9',      label: '9',      second: null,          row: 6, col: 4, face: 'white' },
  { id: 'sub',     label: '−',      second: '◐',           row: 6, col: 5, face: 'darkblue' },

  // row 7
  { id: 'var',     label: 'x y z t a b c', second: 'clear var', row: 7, col: 1, face: 'blue' },
  { id: 'd4',      label: '4',      second: null,          row: 7, col: 2, face: 'white' },
  { id: 'd5',      label: '5',      second: null,          row: 7, col: 3, face: 'white' },
  { id: 'd6',      label: '6',      second: null,          row: 7, col: 4, face: 'white' },
  { id: 'add',     label: '+',      second: '◑',           row: 7, col: 5, face: 'darkblue' },

  // row 8
  { id: 'sto',     label: 'sto►',   second: 'recall',      row: 8, col: 1, face: 'blue' },
  { id: 'd1',      label: '1',      second: null,          row: 8, col: 2, face: 'white' },
  { id: 'd2',      label: '2',      second: null,          row: 8, col: 3, face: 'white' },
  { id: 'd3',      label: '3',      second: null,          row: 8, col: 4, face: 'white' },
  { id: 'toggle',  label: '◄►',     second: null,          row: 8, col: 5, face: 'darkblue' },

  // row 9
  { id: 'on',      label: 'on',     second: 'off',         row: 9, col: 1, face: 'blue' },
  { id: 'd0',      label: '0',      second: 'reset',       row: 9, col: 2, face: 'white' },
  { id: 'dot',     label: '.',      second: ',',           row: 9, col: 3, face: 'white' },
  { id: 'neg',     label: '(−)',    second: 'ans',         row: 9, col: 4, face: 'white' },
  { id: 'enter',   label: 'enter',  second: null,          row: 9, col: 5, face: 'darkblue' },
];

/** Keys whose 2nd position holds a contrast icon rather than a function. */
export const CONTRAST_KEYS = new Set(['sub', 'add']);

/** The variable cycle produced by repeatedly pressing the `var` key. */
export const VAR_CYCLE = ['x', 'y', 'z', 't', 'a', 'b', 'c'];

/** @type {Map<string, Key>} */
export const KEY_BY_ID = new Map(KEYS.map((k) => [k.id, k]));

/** @param {string} id */
export function isKey(id) {
  return KEY_BY_ID.has(id);
}
