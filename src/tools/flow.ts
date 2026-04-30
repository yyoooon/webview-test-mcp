import { ensureConnected, state } from '../state.js';
import { compileFlow, FlowInput, FlowStep } from '../flow-compiler.js';
import { applyPayloadGuard } from '../payload-guard.js';
import { FlowError } from '../errors.js';
import { inputTap } from '../adb.js';

interface SegmentResult {
  marks: unknown[];
  totalMs: number;
  captured?: Record<string, unknown>;
  osTap?: { i: number; x: number; y: number; selector: unknown };
  failedAt?: number;
  snapshot?: unknown;
}

export const definition = {
  name: 'webview_flow',
  description:
    '선언형 step 배열을 한 번에 실행합니다. multi-step 시나리오 (클릭 → 대기 → 캡처/검증)를 1콜로 묶어 토큰/지연을 줄입니다. **디자인 적용 검증**에는 inspect step, **OS-level 터치**(키보드 안 뜨는 등)에는 osTap step을 사용. JS를 직접 짤 필요 없는 케이스에 우선 사용하고, 표현이 부족하면 webview_evaluate로 fallback.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      steps: {
        type: 'array',
        description:
          'FlowStep 배열. 각 요소는 click/type/waitFor/sleep/goto/capture/raw/assert/inspect/osTap 중 하나. inspect 예: `{ inspect: { title: { selector: "h1", style: ["fontSize","fontWeight"], text: true } } }`. osTap 예: `{ osTap: "#search-input" }` 또는 `{ osTap: { selector: "#btn", offsetX: 0, offsetY: -10 } }` — 좌표는 devicePixelRatio로 자동 스케일링되어 ADB shell input tap으로 실행.',
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
    const bail = args.bail ?? 'on-error';

    const allMarks: unknown[] = [];
    let captured: Record<string, unknown> | undefined;
    let totalMs = 0;
    let failedAt: number | undefined;
    let snapshot: unknown;

    let remainingSteps: FlowStep[] = args.steps as FlowStep[];
    let startIndex = 0;

    while (remainingSteps.length > 0) {
      const expr = compileFlow({ steps: remainingSteps, bail }, { startIndex });
      const evalResult = (await cdp.send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      })) as { result: { value: SegmentResult }; exceptionDetails?: { exception?: { description?: string } } };

      if (evalResult.exceptionDetails) {
        const desc = evalResult.exceptionDetails.exception?.description || 'Unknown';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[JS_ERROR] flow 실행 중 예외: ${desc}` }],
        };
      }

      const segment = evalResult.result.value;
      allMarks.push(...segment.marks);
      totalMs += segment.totalMs;
      if (segment.captured) captured = { ...(captured ?? {}), ...segment.captured };

      if (segment.osTap) {
        await inputTap(segment.osTap.x, segment.osTap.y, state.deviceId ?? undefined);
        const consumedCount = segment.osTap.i - startIndex + 1;
        remainingSteps = remainingSteps.slice(consumedCount);
        startIndex = segment.osTap.i + 1;
        continue;
      }

      if (segment.failedAt !== undefined) {
        failedAt = segment.failedAt;
        snapshot = segment.snapshot;
      }
      break;
    }

    const merged: SegmentResult = { marks: allMarks, totalMs };
    if (captured !== undefined) merged.captured = captured;
    if (failedAt !== undefined) merged.failedAt = failedAt;
    if (snapshot !== undefined) merged.snapshot = snapshot;

    const guarded = applyPayloadGuard(merged, args.outputMaxBytes ?? DEFAULT_MAX_BYTES);
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
