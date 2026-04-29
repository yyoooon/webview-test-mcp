import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { VISIBLE_FILTER_JS } from '../src/selector.js';

function evalInDom(html: string, expr: string): unknown {
  const window = new Window({
    width: 360,
    height: 800,
  });
  window.document.body.innerHTML = html;
  return window.eval(`(${expr})`);
}

describe('VISIBLE_FILTER_JS', () => {
  it('returns true for visible element', () => {
    const result = evalInDom(
      '<button id="x">Hi</button>',
      `${VISIBLE_FILTER_JS}(document.getElementById('x'))`,
    );
    expect(result).toBe(true);
  });

  it('returns false for display:none', () => {
    const result = evalInDom(
      '<button id="x" style="display:none">Hi</button>',
      `${VISIBLE_FILTER_JS}(document.getElementById('x'))`,
    );
    expect(result).toBe(false);
  });

  it('returns false for visibility:hidden', () => {
    const result = evalInDom(
      '<button id="x" style="visibility:hidden">Hi</button>',
      `${VISIBLE_FILTER_JS}(document.getElementById('x'))`,
    );
    expect(result).toBe(false);
  });

  it('returns false for non-element', () => {
    const result = evalInDom(
      '',
      `${VISIBLE_FILTER_JS}(null)`,
    );
    expect(result).toBe(false);
  });
});
