import {
  Selector,
  selectorSnippet,
  fuzzyCandidatesSnippet,
  VISIBLE_FILTER_JS,
} from "./selector.js";

export interface ClickStep {
  click: Selector;
}
export interface TypeStep {
  type: { selector: Selector; text: string };
}
export interface WaitForStep {
  waitFor: WaitCond;
  timeout?: number;
}
export interface SleepStep {
  sleep: number;
}
export interface GotoStep {
  goto: string;
}
export interface CaptureStep {
  capture: CaptureSpec;
}
export interface RawStep {
  raw: string;
}
export interface AssertStep {
  assert: {
    kind: "text-visible" | "url-equals" | "no-dialog";
    value?: string;
  };
}

export type FlowStep =
  | ClickStep
  | TypeStep
  | WaitForStep
  | SleepStep
  | GotoStep
  | CaptureStep
  | RawStep
  | AssertStep;

export type WaitCond =
  | { selector: string }
  | { text: string; within?: string }
  | { role: string }
  | { gone: string }
  | { url: string };

export interface CaptureSpec {
  url?: boolean;
  scenario?: boolean;
  dialog?: { buttons?: boolean; text?: boolean; headings?: boolean };
  toast?: boolean;
  storage?: { session?: string[]; local?: string[] };
  custom?: Record<string, string>;
}

export interface FlowInput {
  steps: FlowStep[];
  bail?: "on-error" | "continue";
  outputMaxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

function escJson(value: unknown): string {
  return JSON.stringify(value);
}

function compileStep(step: FlowStep, index: number): string {
  if ("click" in step) {
    const sel = selectorSnippet(step.click);
    return `
      const __t = performance.now();
      const __el = ${sel};
      if (!__el) {
        const __sim = ${fuzzyCandidatesSnippet()};
        marks.push({ i: ${index}, kind: 'click', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND', similar: __sim });
        return { failed: ${index} };
      }
      __el.click();
      marks.push({ i: ${index}, kind: 'click', ok: true, ms: Math.round(performance.now() - __t) });
    `;
  }
  if ("sleep" in step) {
    return `
      const __t = performance.now();
      await new Promise((r) => setTimeout(r, ${step.sleep}));
      marks.push({ i: ${index}, kind: 'sleep', ok: true, ms: Math.round(performance.now() - __t) });
    `;
  }
  if ("raw" in step) {
    return `
      const __t = performance.now();
      try {
        await (async () => { ${step.raw} })();
        marks.push({ i: ${index}, kind: 'raw', ok: true, ms: Math.round(performance.now() - __t) });
      } catch (e) {
        marks.push({ i: ${index}, kind: 'raw', ok: false, ms: Math.round(performance.now() - __t), error: 'JS_ERROR', detail: String(e?.message ?? e) });
        return { failed: ${index} };
      }
    `;
  }
  if ("waitFor" in step) {
    const timeoutMs = step.timeout ?? DEFAULT_TIMEOUT_MS;
    return compileWaitFor(step.waitFor, timeoutMs, index);
  }
  if ("goto" in step) {
    return `
      const __t = performance.now();
      history.pushState({}, '', ${escJson(step.goto)});
      window.dispatchEvent(new PopStateEvent('popstate'));
      marks.push({ i: ${index}, kind: 'goto', ok: true, ms: Math.round(performance.now() - __t) });
    `;
  }
  if ("type" in step) {
    const sel = selectorSnippet(step.type.selector);
    const text = JSON.stringify(step.type.text);
    return `
      const __t = performance.now();
      const __el = ${sel};
      if (!__el) {
        marks.push({ i: ${index}, kind: 'type', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND' });
        return { failed: ${index} };
      }
      __el.focus();
      if ('value' in __el) { __el.value = ${text}; __el.dispatchEvent(new Event('input', { bubbles: true })); __el.dispatchEvent(new Event('change', { bubbles: true })); }
      marks.push({ i: ${index}, kind: 'type', ok: true, ms: Math.round(performance.now() - __t) });
    `;
  }
  if ("assert" in step) {
    return compileAssert(step.assert, index);
  }
  if ("capture" in step) {
    return compileCapture(step.capture, index);
  }
  return `marks.push({ i: ${index}, kind: 'unknown', ok: false, error: 'INVALID_STEP' }); return { failed: ${index} };`;
}

function compileWaitFor(
  cond: WaitCond,
  timeoutMs: number,
  index: number,
): string {
  let test: string;
  if ("selector" in cond) {
    test = `(() => { const el = document.querySelector(${escJson(cond.selector)}); return el && (${VISIBLE_FILTER_JS})(el); })()`;
  } else if ("gone" in cond) {
    test = `(() => { const el = document.querySelector(${escJson(cond.gone)}); return !el || !(${VISIBLE_FILTER_JS})(el); })()`;
  } else if ("role" in cond) {
    const sel = `[role=${JSON.stringify(cond.role)}]`;
    test = `(() => { const el = document.querySelector(${escJson(sel)}); return el && (${VISIBLE_FILTER_JS})(el); })()`;
  } else if ("text" in cond) {
    const within = cond.within
      ? `document.querySelector(${escJson(cond.within)}) ?? document.body`
      : "document.body";
    test = `(() => {
      const root = ${within};
      if (!root) return false;
      const isVis = ${VISIBLE_FILTER_JS};
      return [...root.querySelectorAll('*')].some((el) => isVis(el) && (el.textContent || '').includes(${escJson(cond.text)}));
    })()`;
  } else {
    test = `location.pathname.startsWith(${escJson(cond.url)})`;
  }
  return `
    const __t = performance.now();
    const __end = __t + ${timeoutMs};
    let __ok = false;
    while (performance.now() < __end) {
      if (${test}) { __ok = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    marks.push({ i: ${index}, kind: 'waitFor', ok: __ok, ms: Math.round(performance.now() - __t) });
    if (!__ok) {
      marks[marks.length - 1].error = 'WAIT_TIMEOUT';
      marks[marks.length - 1].cond = ${escJson(cond)};
      return { failed: ${index} };
    }
  `;
}

function compileAssert(spec: AssertStep["assert"], index: number): string {
  let test: string;
  if (spec.kind === "text-visible") {
    const v = JSON.stringify(spec.value ?? "");
    test = `[...document.body.querySelectorAll('*')].some((el) => (${VISIBLE_FILTER_JS})(el) && (el.textContent || '').includes(${v}))`;
  } else if (spec.kind === "url-equals") {
    test = `location.pathname === ${JSON.stringify(spec.value ?? "")}`;
  } else {
    test = `!document.querySelector('[role=dialog]')`;
  }
  return `
    const __t = performance.now();
    const __ok = ${test};
    marks.push({ i: ${index}, kind: 'assert', ok: __ok, ms: Math.round(performance.now() - __t), spec: ${escJson(spec)} });
    if (!__ok) { marks[marks.length - 1].error = 'ASSERT_FAILED'; return { failed: ${index} }; }
  `;
}

function compileCapture(spec: CaptureSpec, index: number): string {
  const fragments: string[] = [];
  if (spec.url) fragments.push(`out.url = location.pathname;`);
  if (spec.scenario) {
    fragments.push(
      `try { out.scenario = JSON.parse(sessionStorage.getItem('scenario_step') || '""'); } catch { out.scenario = null; }`,
    );
  }
  if (spec.toast) {
    fragments.push(
      `out.toast = [...document.querySelectorAll('[data-sonner-toast]')].map((el) => (el.textContent || '').trim()).filter(Boolean);`,
    );
  }
  if (spec.dialog) {
    const buttons = spec.dialog.buttons
      ? `dlg ? [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null`
      : "undefined";
    const text = spec.dialog.text
      ? `dlg ? (dlg.textContent || '').trim() : null`
      : "undefined";
    const headings = spec.dialog.headings
      ? `dlg ? [...dlg.querySelectorAll('h1,h2,h3,h4')].map((h) => (h.textContent || '').trim()) : null`
      : "undefined";
    fragments.push(`{
      const dlg = document.querySelector('[role=dialog]');
      out.dialog = { present: !!dlg, buttons: ${buttons}, text: ${text}, headings: ${headings} };
    }`);
  }
  if (spec.storage) {
    const session = spec.storage.session ?? [];
    const local = spec.storage.local ?? [];
    fragments.push(`{
      const s = {};
      ${session
        .map(
          (k) =>
            `try { s[${JSON.stringify(k)}] = JSON.parse(sessionStorage.getItem(${JSON.stringify(k)}) || 'null'); } catch { s[${JSON.stringify(k)}] = sessionStorage.getItem(${JSON.stringify(k)}); }`,
        )
        .join("\n")}
      const l = {};
      ${local
        .map(
          (k) =>
            `try { l[${JSON.stringify(k)}] = JSON.parse(localStorage.getItem(${JSON.stringify(k)}) || 'null'); } catch { l[${JSON.stringify(k)}] = localStorage.getItem(${JSON.stringify(k)}); }`,
        )
        .join("\n")}
      out.storage = { session: s, local: l };
    }`);
  }
  if (spec.custom) {
    for (const [key, expr] of Object.entries(spec.custom)) {
      fragments.push(
        `try { out[${JSON.stringify(key)}] = (() => (${expr}))(); } catch (e) { out[${JSON.stringify(key)}] = { __error: String(e?.message ?? e) }; }`,
      );
    }
  }
  return `
    const __t = performance.now();
    const out = {};
    ${fragments.join("\n")}
    captured = out;
    marks.push({ i: ${index}, kind: 'capture', ok: true, ms: Math.round(performance.now() - __t) });
  `;
}

export function compileFlow(input: FlowInput): string {
  const bail = input.bail ?? "on-error";
  const stepsCode = input.steps
    .map(
      (step, i) =>
        `await (async () => { ${compileStep(step, i)} })().then((r) => { if (r && r.failed !== undefined) failed = r.failed; });
${bail === "on-error" ? `if (failed !== null) return;` : ""}`,
    )
    .join("\n");

  return `(async () => {
    const __t0 = performance.now();
    const marks = [];
    let captured = null;
    let failed = null;
    await (async () => {
      ${stepsCode}
    })();
    const result = { marks, totalMs: Math.round(performance.now() - __t0) };
    if (captured !== null) result.captured = captured;
    if (failed !== null) result.failedAt = failed;
    return result;
  })()`;
}
