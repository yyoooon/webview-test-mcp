import { ensureConnected } from '../state.js';
import { compileFlow, FlowInput } from '../flow-compiler.js';
import { applyPayloadGuard } from '../payload-guard.js';
import { FlowError } from '../errors.js';

export const definition = {
  name: 'webview_flow',
  description:
    '선언형 step 배열을 한 번에 실행합니다. multi-step 시나리오 (클릭 → 대기 → 캡처/검증)를 1콜로 묶어 토큰/지연을 줄입니다. **디자인 적용 검증**에는 inspect step으로 여러 selector의 computed style을 한 번에 뽑아 Figma spec과 비교하세요. JS를 직접 짤 필요 없는 케이스에 우선 사용하고, 표현이 부족하면 webview_evaluate로 fallback.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      steps: {
        type: 'array',
        description:
          'FlowStep 배열. 각 요소는 click/type/waitFor/sleep/goto/capture/raw/assert/inspect 중 하나. inspect 예: `{ inspect: { title: { selector: "h1", style: ["fontSize","fontWeight","lineHeight"], text: true } } }` → captured.inspect.title 으로 결과 반환.',
      },
      bail: {
        type: 'string',
        enum: ['on-error', 'continue'],
        description: '기본 on-error: 실패 즉시 중단',
      },
      outputMaxBytes: {
        type: 'number',
        description: 'capture 결과 byte 상한 (기본 10000)',
      },
    },
    required: ['steps'],
  },
};

const DEFAULT_MAX_BYTES = 10_000;

export async function flowHandler(args: Partial<FlowInput>) {
  try {
    if (!args.steps || !Array.isArray(args.steps) || args.steps.length === 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'steps 배열은 필수이며 1개 이상이어야 합니다.' }],
      };
    }
    const cdp = await ensureConnected();
    const expr = compileFlow({
      steps: args.steps,
      bail: args.bail ?? 'on-error',
    });
    const result = (await cdp.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })) as { result: { value: unknown }; exceptionDetails?: { exception?: { description?: string } } };

    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || 'Unknown';
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `[JS_ERROR] flow 실행 중 예외: ${desc}` }],
      };
    }

    const guarded = applyPayloadGuard(result.result.value, args.outputMaxBytes ?? DEFAULT_MAX_BYTES);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(guarded, null, 2) }],
    };
  } catch (error) {
    if (error instanceof FlowError) {
      const extras = error.extras ? `\n${JSON.stringify(error.extras, null, 2)}` : '';
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `[${error.code}] ${error.message}${extras}` }],
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `flow 실패: ${msg}` }],
    };
  }
}
