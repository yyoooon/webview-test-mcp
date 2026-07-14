import { ensureConnected } from '../state.js';
import { VISIBLE_FILTER_JS } from '../selector.js';

export const definition = {
  name: 'webview_wait_for',
  description:
    'CSS selector가 나타나거나(selector), 사라지거나(gone), role 요소가 보이거나(role), JS 조건이 만족될 때까지(expression) 대기합니다. selector/gone/role/expression 중 하나 필수. (webview_flow의 waitFor와 인자 스펙 통일)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      selector: { type: 'string', description: '나타날 때까지 대기할 CSS selector' },
      gone: { type: 'string', description: '사라질 때까지 대기할 CSS selector (미존재 또는 비가시)' },
      role: { type: 'string', description: '보일 때까지 대기할 ARIA role (예: "dialog"). [role=x]로 매칭' },
      expression: { type: 'string', description: '대기할 JS 표현식 (truthy 반환 시 완료)' },
      timeout: { type: 'number', description: '타임아웃 (ms, 기본 10000)' },
    },
  },
};

const POLL_INITIAL = 50;
const POLL_MAX = 200;
const POLL_GROWTH = 1.5;
const DEFAULT_TIMEOUT = 10_000;

interface WaitArgs {
  selector?: string;
  gone?: string;
  role?: string;
  expression?: string;
  timeout?: number;
}

/** 대기 조건 → 브라우저에서 평가할 truthy 표현식 + 사람이 읽을 라벨. */
function buildCheck(args: WaitArgs): { expression: string; label: string; goal: string } | null {
  if (args.selector) {
    const sel = args.selector.replace(/'/g, "\\'");
    return {
      expression: `document.querySelector('${sel}') !== null`,
      label: `"${args.selector}" 발견`,
      goal: `"${args.selector}" 미발견`,
    };
  }
  if (args.gone) {
    const sel = JSON.stringify(args.gone);
    return {
      expression: `(() => { const el = document.querySelector(${sel}); return !el || !(${VISIBLE_FILTER_JS})(el); })()`,
      label: `"${args.gone}" 사라짐`,
      goal: `"${args.gone}" 여전히 존재`,
    };
  }
  if (args.role) {
    const sel = JSON.stringify(`[role="${args.role}"]`);
    return {
      expression: `(() => { const el = document.querySelector(${sel}); return !!(el && (${VISIBLE_FILTER_JS})(el)); })()`,
      label: `role="${args.role}" 노출`,
      goal: `role="${args.role}" 미노출`,
    };
  }
  if (args.expression) {
    return { expression: args.expression, label: '조건 충족', goal: '조건 미충족' };
  }
  return null;
}

export async function handler(args: WaitArgs) {
  try {
    const check = buildCheck(args);
    if (!check) {
      return { isError: true, content: [{ type: 'text' as const, text: 'selector / gone / role / expression 중 하나는 필수입니다.' }] };
    }
    const cdp = await ensureConnected();
    const timeout = args.timeout ?? DEFAULT_TIMEOUT;
    const startTime = Date.now();
    let interval = POLL_INITIAL;
    while (true) {
      const result = (await cdp.send('Runtime.evaluate', { expression: check.expression, returnByValue: true })) as { result: { value: unknown } };
      if (result.result.value) {
        return { content: [{ type: 'text' as const, text: `조건 충족 — ${check.label}` }] };
      }
      if (Date.now() - startTime >= timeout) {
        return { isError: true, content: [{ type: 'text' as const, text: `시간 초과 (${timeout}ms): ${check.goal}` }] };
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
      interval = Math.min(Math.round(interval * POLL_GROWTH), POLL_MAX);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `대기 실패: ${msg}` }] };
  }
}
