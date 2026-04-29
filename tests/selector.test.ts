import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { VISIBLE_FILTER_JS, selectorSnippet } from '../src/selector.js';

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

describe('selectorSnippet — CSS', () => {
  it('finds element by CSS selector', () => {
    const snippet = selectorSnippet('#submit');
    const result = evalInDom(
      '<button id="submit">Go</button>',
      `${snippet}.tagName`,
    );
    expect(result).toBe('BUTTON');
  });

  it('returns null when CSS selector matches no element', () => {
    const snippet = selectorSnippet('#missing');
    const result = evalInDom('<div></div>', snippet);
    expect(result).toBeNull();
  });

  it('skips invisible matches', () => {
    const snippet = selectorSnippet('button');
    const result = evalInDom(
      '<button style="display:none">Hidden</button><button>Visible</button>',
      `${snippet}?.textContent`,
    );
    expect(result).toBe('Visible');
  });
});

describe('selectorSnippet — testId', () => {
  it('finds by data-testid', () => {
    const snippet = selectorSnippet({ testId: 'cta' });
    const result = evalInDom(
      '<button data-testid="cta">Click</button>',
      `${snippet}.textContent`,
    );
    expect(result).toBe('Click');
  });
});

describe('selectorSnippet — text', () => {
  it('finds by exact text match', () => {
    const snippet = selectorSnippet({ text: 'Confirm' });
    const result = evalInDom(
      '<button>Cancel</button><button>Confirm</button>',
      `${snippet}?.textContent`,
    );
    expect(result).toBe('Confirm');
  });

  it('falls back to partial match when no exact match', () => {
    const snippet = selectorSnippet({ text: 'Confirm' });
    const result = evalInDom(
      '<button>Confirm changes</button>',
      `${snippet}?.textContent`,
    );
    expect(result).toBe('Confirm changes');
  });

  it('prefers exact match over partial', () => {
    const snippet = selectorSnippet({ text: 'Save' });
    const result = evalInDom(
      '<button>Save changes</button><button>Save</button>',
      `${snippet}?.textContent`,
    );
    expect(result).toBe('Save');
  });

  it('scopes match to within container', () => {
    const snippet = selectorSnippet({ text: 'Confirm', within: '[role=dialog]' });
    const result = evalInDom(
      `<button>Confirm</button>
       <div role="dialog"><button>Confirm</button></div>`,
      `(() => {
        const el = ${snippet};
        return el?.closest('[role=dialog]') ? 'in-dialog' : 'outside';
      })()`,
    );
    expect(result).toBe('in-dialog');
  });

  it('returns null when text not found', () => {
    const snippet = selectorSnippet({ text: 'Missing' });
    const result = evalInDom('<button>Other</button>', snippet);
    expect(result).toBeNull();
  });
});
