import { selectorSnippet, fuzzyCandidatesSnippet, VISIBLE_FILTER_JS, } from "./selector.js";
function isSelector(value) {
    if (typeof value === "string")
        return true;
    if (value === null || typeof value !== "object")
        return false;
    return "text" in value || "testId" in value;
}
const DEFAULT_TIMEOUT_MS = 5000;
function escJson(value) {
    return JSON.stringify(value);
}
function compileStep(step, index) {
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
        if (typeof step.goto === "string") {
            return `
      const __t = performance.now();
      history.pushState({}, '', ${escJson(step.goto)});
      window.dispatchEvent(new PopStateEvent('popstate'));
      const __m = { i: ${index}, kind: 'goto', ok: true, ms: Math.round(performance.now() - __t) };
      // Next.js App Router는 수동 pushState를 라우팅 신호로 안 받아 화면이 안 바뀔 수 있음 → 경고.
      const __isNext = (typeof window.next !== 'undefined') || !!document.querySelector('#__next, script[src*="/_next/"]');
      if (__isNext) __m.warn = 'NEXTJS_SOFT_NAV';
      marks.push(__m);
    `;
        }
        return compileNav(step.goto, index);
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
    if ("inspect" in step) {
        return compileInspect(step.inspect, index);
    }
    if ("osTap" in step) {
        return compileOsTap(step.osTap, index);
    }
    if ("scroll" in step) {
        return compileScroll(step.scroll, index);
    }
    if ("osSwipe" in step) {
        return compileOsSwipe(step.osSwipe, index);
    }
    if ("osKey" in step) {
        return `
      marks.push({ i: ${index}, kind: 'osKey', ok: true, ms: 0, key: ${JSON.stringify(step.osKey)} });
      return { control: { type: 'osKey', i: ${index}, key: ${JSON.stringify(step.osKey)} } };
    `;
    }
    return `marks.push({ i: ${index}, kind: 'unknown', ok: false, error: 'INVALID_STEP' }); return { failed: ${index} };`;
}
function compileNav(spec, index) {
    const timeoutMs = spec.timeout ?? 10_000;
    if (!spec.url && !spec.reload) {
        return `marks.push({ i: ${index}, kind: 'goto', ok: false, error: 'INVALID_STEP', detail: 'goto 객체는 url 또는 reload가 필요합니다' }); return { failed: ${index} };`;
    }
    const urlExpr = spec.url
        ? `new URL(${escJson(spec.url)}, location.href).href`
        : "location.href";
    const reload = spec.reload && !spec.url ? "true" : "false";
    return `
    const __url = ${urlExpr};
    marks.push({ i: ${index}, kind: 'goto', ok: true, ms: 0, nav: __url });
    return { control: { type: 'nav', i: ${index}, url: __url, reload: ${reload}, timeoutMs: ${timeoutMs} } };
  `;
}
function compileOsTap(spec, index) {
    const { selector, offsetX, offsetY } = isSelector(spec)
        ? { selector: spec, offsetX: 0, offsetY: 0 }
        : { selector: spec.selector, offsetX: spec.offsetX ?? 0, offsetY: spec.offsetY ?? 0 };
    const sel = selectorSnippet(selector);
    return `
    const __t = performance.now();
    const __el = ${sel};
    if (!__el) {
      const __sim = ${fuzzyCandidatesSnippet()};
      marks.push({ i: ${index}, kind: 'osTap', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND', similar: __sim });
      return { failed: ${index} };
    }
    const __r = __el.getBoundingClientRect();
    const __dpr = window.devicePixelRatio || 1;
    const __cx = Math.round((__r.x + __r.width / 2 + ${offsetX}) * __dpr);
    const __cy = Math.round((__r.y + __r.height / 2 + ${offsetY}) * __dpr);
    marks.push({ i: ${index}, kind: 'osTap', ok: true, ms: Math.round(performance.now() - __t), x: __cx, y: __cy });
    return { control: { type: 'osTap', i: ${index}, x: __cx, y: __cy, selector: ${JSON.stringify(selector)} } };
  `;
}
function compileOsSwipe(spec, index) {
    const durationMs = spec.durationMs ?? 300;
    const fromSnippet = spec.from ? selectorSnippet(spec.from) : "null";
    const distExpr = spec.distance !== undefined
        ? String(spec.distance)
        : `(__axis === 'left' || __axis === 'right' ? __vw : __vh) * 0.4`;
    return `
    const __t = performance.now();
    const __from = ${fromSnippet};
    ${spec.from
        ? `if (!__from) { marks.push({ i: ${index}, kind: 'osSwipe', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND' }); return { failed: ${index} }; }`
        : ""}
    const __vw = window.innerWidth, __vh = window.innerHeight;
    let __sx = __vw / 2, __sy = __vh / 2;
    if (__from) { const __r = __from.getBoundingClientRect(); __sx = __r.x + __r.width / 2; __sy = __r.y + __r.height / 2; }
    const __axis = ${JSON.stringify(spec.direction)};
    const __dist = ${distExpr};
    let __ex = __sx, __ey = __sy;
    if (__axis === 'up') __ey = __sy - __dist;
    else if (__axis === 'down') __ey = __sy + __dist;
    else if (__axis === 'left') __ex = __sx - __dist;
    else __ex = __sx + __dist;
    const __dpr = window.devicePixelRatio || 1;
    marks.push({ i: ${index}, kind: 'osSwipe', ok: true, ms: Math.round(performance.now() - __t) });
    return { control: { type: 'osSwipe', i: ${index}, x1: Math.round(__sx * __dpr), y1: Math.round(__sy * __dpr), x2: Math.round(__ex * __dpr), y2: Math.round(__ey * __dpr), durationMs: ${durationMs} } };
  `;
}
function compileScroll(spec, index) {
    if ("to" in spec) {
        const sel = selectorSnippet(spec.to);
        const block = JSON.stringify(spec.block ?? "center");
        return `
      const __t = performance.now();
      const __el = ${sel};
      if (!__el) {
        const __sim = ${fuzzyCandidatesSnippet()};
        marks.push({ i: ${index}, kind: 'scroll', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND', similar: __sim });
        return { failed: ${index} };
      }
      __el.scrollIntoView({ block: ${block}, behavior: 'instant' });
      marks.push({ i: ${index}, kind: 'scroll', ok: true, ms: Math.round(performance.now() - __t) });
    `;
    }
    const x = spec.by.x ?? 0;
    const y = spec.by.y ?? 0;
    if (spec.container) {
        return `
      const __t = performance.now();
      const __c = document.querySelector(${escJson(spec.container)});
      if (!__c) {
        marks.push({ i: ${index}, kind: 'scroll', ok: false, ms: Math.round(performance.now() - __t), error: 'SELECTOR_NOT_FOUND' });
        return { failed: ${index} };
      }
      __c.scrollBy({ left: ${x}, top: ${y}, behavior: 'instant' });
      marks.push({ i: ${index}, kind: 'scroll', ok: true, ms: Math.round(performance.now() - __t) });
    `;
    }
    return `
    const __t = performance.now();
    window.scrollBy({ left: ${x}, top: ${y}, behavior: 'instant' });
    marks.push({ i: ${index}, kind: 'scroll', ok: true, ms: Math.round(performance.now() - __t) });
  `;
}
function compileInspect(spec, index) {
    const targetFragments = Object.entries(spec).map(([key, target]) => {
        const sel = JSON.stringify(target.selector);
        const styleProps = target.style ? JSON.stringify(target.style) : "null";
        const attrNames = target.attr ? JSON.stringify(target.attr) : "null";
        const rectKeys = Array.isArray(target.rect)
            ? JSON.stringify(target.rect)
            : target.rect
                ? JSON.stringify(["x", "y", "width", "height"])
                : "null";
        const wantText = target.text ? "true" : "false";
        const wantClass = target.classList ? "true" : "false";
        return `(() => {
      const el = document.querySelector(${sel});
      if (!el) { values[${JSON.stringify(key)}] = { __error: 'SELECTOR_NOT_FOUND', selector: ${sel} }; return; }
      const out = {};
      const styleProps = ${styleProps};
      if (styleProps) {
        const cs = getComputedStyle(el);
        for (const p of styleProps) out[p] = cs[p];
      }
      if (${wantText}) out.text = (el.textContent || '').trim();
      if (${wantClass}) out.classList = [...el.classList];
      const rectKeys = ${rectKeys};
      if (rectKeys) {
        const r = el.getBoundingClientRect();
        for (const k of rectKeys) out[k] = Math.round(r[k] * 100) / 100;
      }
      const attrNames = ${attrNames};
      if (attrNames) {
        for (const a of attrNames) out[a] = el.getAttribute(a);
      }
      values[${JSON.stringify(key)}] = out;
    })();`;
    });
    return `
    const __t = performance.now();
    const values = {};
    ${targetFragments.join("\n")}
    captured = Object.assign({}, captured ?? {}, { inspect: values });
    marks.push({ i: ${index}, kind: 'inspect', ok: true, ms: Math.round(performance.now() - __t) });
  `;
}
function compileAppearsThenGone(selector, windowMs, index) {
    const sel = escJson(selector);
    return `
    const __t = performance.now();
    const __end = __t + ${windowMs};
    const __isVis = ${VISIBLE_FILTER_JS};
    let __appeared = false, __wentGone = false, __hits = 0, __wasVis = false;
    while (performance.now() < __end) {
      const __el = document.querySelector(${sel});
      const __v = !!(__el && __isVis(__el));
      if (__v) { __hits++; __appeared = true; __wasVis = true; }
      else { if (__wasVis) __wentGone = true; __wasVis = false; }
      await new Promise((r) => setTimeout(r, 30));
    }
    marks.push({ i: ${index}, kind: 'waitFor', ok: true, ms: Math.round(performance.now() - __t), observed: { appeared: __appeared, wentGone: __wentGone, hits: __hits } });
  `;
}
/** "POST /path" 또는 { method, url } → 매칭용 method/urlContains 추출. */
function parseNetworkCond(spec) {
    if (typeof spec === "string") {
        const trimmed = spec.trim();
        const m = trimmed.match(/^([A-Z]+)\s+(.+)$/);
        if (m)
            return { method: m[1], urlContains: m[2] };
        return { method: null, urlContains: trimmed };
    }
    return { method: spec.method ?? null, urlContains: spec.url };
}
function compileNetWait(spec, timeoutMs, index) {
    const { method, urlContains } = parseNetworkCond(spec);
    // 실제 매칭/대기는 Node 레이어(flowHandler)에서 CDP Network 이벤트로 수행. 여기선 control 신호만 발행.
    return `
    return { control: { type: 'netwait', i: ${index}, method: ${JSON.stringify(method)}, urlContains: ${JSON.stringify(urlContains)}, timeoutMs: ${timeoutMs} } };
  `;
}
function compileWaitFor(cond, timeoutMs, index) {
    if ("appearsThenGone" in cond) {
        return compileAppearsThenGone(cond.appearsThenGone, cond.windowMs ?? 2000, index);
    }
    if ("network" in cond) {
        return compileNetWait(cond.network, cond.timeout ?? 10_000, index);
    }
    let test;
    if ("selector" in cond) {
        test = `(() => { const el = document.querySelector(${escJson(cond.selector)}); return el && (${VISIBLE_FILTER_JS})(el); })()`;
    }
    else if ("gone" in cond) {
        test = `(() => { const el = document.querySelector(${escJson(cond.gone)}); return !el || !(${VISIBLE_FILTER_JS})(el); })()`;
    }
    else if ("role" in cond) {
        const sel = `[role=${JSON.stringify(cond.role)}]`;
        test = `(() => { const el = document.querySelector(${escJson(sel)}); return el && (${VISIBLE_FILTER_JS})(el); })()`;
    }
    else if ("text" in cond) {
        const within = cond.within
            ? `document.querySelector(${escJson(cond.within)}) ?? document.body`
            : "document.body";
        test = `(() => {
      const root = ${within};
      if (!root) return false;
      const isVis = ${VISIBLE_FILTER_JS};
      return [...root.querySelectorAll('*')].some((el) => isVis(el) && (el.textContent || '').includes(${escJson(cond.text)}));
    })()`;
    }
    else {
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
function compileAssert(spec, index) {
    let test;
    if (spec.kind === "text-visible") {
        const v = JSON.stringify(spec.value ?? "");
        test = `[...document.body.querySelectorAll('*')].some((el) => (${VISIBLE_FILTER_JS})(el) && (el.textContent || '').includes(${v}))`;
    }
    else if (spec.kind === "url-equals") {
        test = `location.pathname === ${JSON.stringify(spec.value ?? "")}`;
    }
    else {
        test = `!document.querySelector('[role=dialog]')`;
    }
    return `
    const __t = performance.now();
    const __ok = ${test};
    marks.push({ i: ${index}, kind: 'assert', ok: __ok, ms: Math.round(performance.now() - __t), spec: ${escJson(spec)} });
    if (!__ok) { marks[marks.length - 1].error = 'ASSERT_FAILED'; return { failed: ${index} }; }
  `;
}
function compileCapture(spec, index) {
    const fragments = [];
    if (spec.url)
        fragments.push(`out.url = location.pathname;`);
    if (spec.scenario) {
        fragments.push(`try { out.scenario = JSON.parse(sessionStorage.getItem('scenario_step') || '""'); } catch { out.scenario = null; }`);
    }
    if (spec.toast) {
        fragments.push(`out.toast = [...document.querySelectorAll('[data-sonner-toast]')].map((el) => (el.textContent || '').trim()).filter(Boolean);`);
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
            .map((k) => `try { s[${JSON.stringify(k)}] = JSON.parse(sessionStorage.getItem(${JSON.stringify(k)}) || 'null'); } catch { s[${JSON.stringify(k)}] = sessionStorage.getItem(${JSON.stringify(k)}); }`)
            .join("\n")}
      const l = {};
      ${local
            .map((k) => `try { l[${JSON.stringify(k)}] = JSON.parse(localStorage.getItem(${JSON.stringify(k)}) || 'null'); } catch { l[${JSON.stringify(k)}] = localStorage.getItem(${JSON.stringify(k)}); }`)
            .join("\n")}
      out.storage = { session: s, local: l };
    }`);
    }
    if (spec.custom) {
        for (const [key, expr] of Object.entries(spec.custom)) {
            fragments.push(`try { out[${JSON.stringify(key)}] = (() => (${expr}))(); } catch (e) { out[${JSON.stringify(key)}] = { __error: String(e?.message ?? e) }; }`);
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
const SNAPSHOT_JS = `(() => {
  const isVis = ${VISIBLE_FILTER_JS};
  const dlg = document.querySelector('[role=dialog]');
  return {
    url: location.pathname,
    dialogPresent: !!dlg,
    visibleButtons: [...document.querySelectorAll('button, a, [role=button]')]
      .filter(isVis)
      .slice(0, 10)
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean),
    headings: [...document.querySelectorAll('h1, h2, h3')]
      .filter(isVis)
      .slice(0, 5)
      .map((h) => (h.textContent || '').trim()),
  };
})()`;
export function compileFlow(input, options = {}) {
    const bail = input.bail ?? "on-error";
    const startIndex = options.startIndex ?? 0;
    const stepsCode = input.steps
        .map((step, i) => `await (async () => { ${compileStep(step, i + startIndex)} })().then((r) => {
          if (r && r.failed !== undefined) failed = r.failed;
          if (r && r.control !== undefined) control = r.control;
        });
        if (control !== null) return;
${bail === "on-error" ? `if (failed !== null) return;` : ""}`)
        .join("\n");
    return `(async () => {
    const __t0 = performance.now();
    const marks = [];
    let captured = null;
    let failed = null;
    let control = null;
    await (async () => {
      ${stepsCode}
    })();
    const result = { marks, totalMs: Math.round(performance.now() - __t0) };
    if (captured !== null) result.captured = captured;
    if (control !== null) result.control = control;
    if (failed !== null) {
      result.failedAt = failed;
      result.snapshot = ${SNAPSHOT_JS};
    }
    return result;
  })()`;
}
//# sourceMappingURL=flow-compiler.js.map