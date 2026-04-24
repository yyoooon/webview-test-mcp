import { ensureConnected } from '../state.js';

export const definition = {
  name: 'webview_wait_for',
  description: 'CSS selector가 나타나거나 JS 조건이 만족될 때까지 대기합니다.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      selector: { type: 'string', description: '대기할 CSS selector' },
      expression: { type: 'string', description: '대기할 JS 표현식 (truthy 반환 시 완료)' },
      timeout: { type: 'number', description: '타임아웃 (ms, 기본 10000)' },
    },
  },
};

const POLL_INITIAL = 50;
const POLL_MAX = 200;
const POLL_GROWTH = 1.5;
const DEFAULT_TIMEOUT = 10_000;

export async function handler(args: { selector?: string; expression?: string; timeout?: number }) {
  try {
    if (!args.selector && !args.expression) {
      return { isError: true, content: [{ type: 'text' as const, text: 'selector 또는 expression 중 하나는 필수입니다.' }] };
    }
    const cdp = await ensureConnected();
    const timeout = args.timeout ?? DEFAULT_TIMEOUT;
    const checkExpression = args.selector ? `document.querySelector('${args.selector.replace(/'/g, "\\'")}') !== null` : args.expression!;
    const startTime = Date.now();
    let interval = POLL_INITIAL;
    while (true) {
      const result = (await cdp.send('Runtime.evaluate', { expression: checkExpression, returnByValue: true })) as { result: { value: unknown } };
      if (result.result.value) {
        return { content: [{ type: 'text' as const, text: `조건 충족${args.selector ? ` — "${args.selector}" 발견` : ''}` }] };
      }
      if (Date.now() - startTime >= timeout) {
        return { isError: true, content: [{ type: 'text' as const, text: `시간 초과 (${timeout}ms): ${args.selector ? `"${args.selector}" 미발견` : '조건 미충족'}` }] };
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
      interval = Math.min(Math.round(interval * POLL_GROWTH), POLL_MAX);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: `대기 실패: ${msg}` }] };
  }
}
