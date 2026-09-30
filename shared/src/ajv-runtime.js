// ESM stand-ins for the CommonJS helpers Ajv's standalone output require()s,
// so generated validators load identically in Node, Vite and service workers.
import * as formats from 'ajv-formats/dist/formats.js';

export const fullFormats = formats.fullFormats ?? formats.default?.fullFormats;

export function ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  while (pos < len) {
    length++;
    const value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      if ((str.charCodeAt(pos) & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}

export function equal(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]));
  }
  return a !== a && b !== b; // NaN
}
