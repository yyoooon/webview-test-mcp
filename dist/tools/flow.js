import { ensureConnected, state } from '../state.js';
import { compileFlow } from '../flow-compiler.js';
import { applyPayloadGuard } from '../payload-guard.js';
import { FlowError, ErrorCode } from '../errors.js';
import { inputTap, inputSwipe, inputKeyEvent } from '../adb.js';
function stepIsNetWait(step) {
    return (typeof step === 'object' &&
        step !== null &&
        'waitFor' in step &&
        typeof step.waitFor === 'object' &&
        step.waitFor !== null &&
        'network' in step.waitFor);
}
export const definition = {
    name: 'webview_flow',
    description: '선언형 step 배열을 한 번에 실행합니다. multi-step 시나리오 (클릭 → 대기 → 캡처/검증)를 1콜로 묶어 토큰/지연을 줄입니다. **디자인 적용 검증**에는 inspect step, **OS-level 터치**(키보드 안 뜨는 등)에는 osTap step을 사용. JS를 직접 짤 필요 없는 케이스에 우선 사용하고, 표현이 부족하면 webview_evaluate로 fallback. 스크롤은 scroll(JS)/osSwipe(ADB), OS 키는 osKey, 실제 네비게이션(새로고침/딥링크)은 goto 객체 형태 사용. flow 중 발생한 console error/warning은 결과의 console 필드에 자동 첨부.',
    inputSchema: {
        type: 'object',
        properties: {
            steps: {
                type: 'array',
                description: 'FlowStep 배열. 각 요소는 click/type/waitFor/sleep/goto/capture/raw/assert/inspect/osTap/scroll/osSwipe/osKey 중 하나. inspect 예: `{ inspect: { title: { selector: "h1", style: ["fontSize","fontWeight"], text: true } } }`. osTap 예: `{ osTap: "#search-input" }` 또는 `{ osTap: { selector: "#btn", offsetX: 0, offsetY: -10 } }` — 좌표는 devicePixelRatio로 자동 스케일링되어 ADB shell input tap으로 실행. scroll 예: `{ scroll: { to: \'#footer\' } }` 또는 `{ scroll: { by: { y: 500 }, container: \'#list\' } }`. osSwipe 예: `{ osSwipe: { direction: \'up\' } }` (손가락 방향, ADB input swipe). osKey 예: `{ osKey: \'BACK\' }` (ADB keyevent). 실제 네비게이션 예: `{ goto: { url: \'/deep/link\' } }` 또는 `{ goto: { reload: true } }` — SPA 라우팅은 기존처럼 문자열 `{ goto: \'/path\' }`. waitFor는 selector/text/role/gone/url 외에 **transient 관찰** `{ waitFor: { appearsThenGone: \'#popup\', windowMs: 2000 } }` (windowMs 동안 샘플링해 observed.appeared/wentGone/hits 기록 — 깜빡임 회귀 검증용, flow를 중단하지 않음)와 **네트워크 완료 대기** `{ waitFor: { network: \'POST /gourd/throw\', timeout: 10000 } }` (해당 요청의 response 수신까지 대기 — Lottie 콜백 뒤 POST처럼 지연 요청 후 상태조회 오판 방지) 지원.',
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
export async function flowHandler(args) {
    try {
        if (!args.steps || !Array.isArray(args.steps) || args.steps.length === 0) {
            return {
                isError: true,
                content: [{ type: 'text', text: 'steps 배열은 필수이며 1개 이상이어야 합니다.' }],
            };
        }
        const cdp = await ensureConnected();
        const bail = args.bail ?? 'on-error';
        const consoleBuffer = state.console;
        const consoleCursor = consoleBuffer ? consoleBuffer.cursor : 0;
        const allMarks = [];
        let captured;
        let totalMs = 0;
        let failedAt;
        let snapshot;
        // #5 네트워크 대기: netwait step이 있으면 flow 시작 전에 Network 도메인을 켜고
        // 이벤트를 버퍼링한다 (앞선 click이 유발한 요청도 놓치지 않도록).
        const hasNetWait = args.steps.some(stepIsNetWait);
        const netBuffer = [];
        let netCursor = 0;
        let onReq;
        let onResp;
        if (hasNetWait) {
            const reqMap = new Map();
            onReq = (p) => {
                const id = p.requestId;
                const req = p.request;
                if (id && req?.url)
                    reqMap.set(id, { method: req.method ?? '', url: req.url });
            };
            onResp = (p) => {
                const id = p.requestId;
                const resp = p.response;
                const meta = id ? reqMap.get(id) : undefined;
                if (meta)
                    netBuffer.push({ method: meta.method, url: resp?.url ?? meta.url, status: resp?.status });
            };
            cdp.on('Network.requestWillBeSent', onReq);
            cdp.on('Network.responseReceived', onResp);
            await cdp.send('Network.enable', {});
        }
        let remainingSteps = args.steps;
        let startIndex = 0;
        try {
            while (remainingSteps.length > 0) {
                const expr = compileFlow({ steps: remainingSteps, bail }, { startIndex });
                const evalResult = (await cdp.send('Runtime.evaluate', {
                    expression: expr,
                    awaitPromise: true,
                    returnByValue: true,
                }));
                if (evalResult.exceptionDetails) {
                    const desc = evalResult.exceptionDetails.exception?.description || 'Unknown';
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `[JS_ERROR] flow 실행 중 예외: ${desc}` }],
                    };
                }
                const segment = evalResult.result.value;
                allMarks.push(...segment.marks);
                totalMs += segment.totalMs;
                if (segment.captured)
                    captured = { ...(captured ?? {}), ...segment.captured };
                if (segment.control) {
                    const c = segment.control;
                    let stop = false;
                    if (c.type === 'osTap') {
                        await inputTap(c.x, c.y, state.deviceId ?? undefined);
                    }
                    else if (c.type === 'osSwipe') {
                        await inputSwipe(c.x1, c.y1, c.x2, c.y2, c.durationMs, state.deviceId ?? undefined);
                    }
                    else if (c.type === 'osKey') {
                        await inputKeyEvent(c.key, state.deviceId ?? undefined);
                    }
                    else if (c.type === 'nav') {
                        if (c.reload) {
                            await cdp.send('Page.reload', {});
                        }
                        else {
                            await cdp.send('Page.navigate', { url: c.url });
                        }
                        await waitForPageLoad(cdp, c.timeoutMs);
                    }
                    else if (c.type === 'netwait') {
                        const t0 = Date.now();
                        const deadline = t0 + c.timeoutMs;
                        let matched;
                        while (Date.now() < deadline) {
                            for (let k = netCursor; k < netBuffer.length; k++) {
                                const e = netBuffer[k];
                                if ((c.method == null || e.method === c.method) && e.url.includes(c.urlContains)) {
                                    matched = e;
                                    netCursor = k + 1;
                                    break;
                                }
                            }
                            if (matched)
                                break;
                            await new Promise((r) => setTimeout(r, 100));
                        }
                        const ms = Date.now() - t0;
                        if (matched) {
                            allMarks.push({ i: c.i, kind: 'waitFor', ok: true, ms, matched });
                        }
                        else {
                            allMarks.push({
                                i: c.i,
                                kind: 'waitFor',
                                ok: false,
                                ms,
                                error: 'NETWORK_TIMEOUT',
                                cond: { method: c.method, urlContains: c.urlContains },
                                observed: netBuffer.slice(-8),
                            });
                            failedAt = c.i;
                            if (bail === 'on-error')
                                stop = true;
                        }
                    }
                    if (segment.failedAt !== undefined) {
                        failedAt = segment.failedAt;
                        snapshot = segment.snapshot;
                    }
                    if (stop)
                        break;
                    const consumedCount = c.i - startIndex + 1;
                    remainingSteps = remainingSteps.slice(consumedCount);
                    startIndex = c.i + 1;
                    continue;
                }
                if (segment.failedAt !== undefined) {
                    failedAt = segment.failedAt;
                    snapshot = segment.snapshot;
                }
                break;
            }
            const merged = { marks: allMarks, totalMs };
            if (captured !== undefined)
                merged.captured = captured;
            if (failedAt !== undefined)
                merged.failedAt = failedAt;
            if (snapshot !== undefined)
                merged.snapshot = snapshot;
            const consoleLogs = consoleBuffer
                ?.since(consoleCursor)
                .filter((e) => e.level === 'error' || e.level === 'warning') ?? [];
            if (consoleLogs.length > 0)
                merged.console = consoleLogs;
            const guarded = applyPayloadGuard(merged, args.outputMaxBytes ?? DEFAULT_MAX_BYTES);
            return {
                content: [{ type: 'text', text: JSON.stringify(guarded, null, 2) }],
            };
        }
        finally {
            if (hasNetWait) {
                if (onReq)
                    cdp.off('Network.requestWillBeSent', onReq);
                if (onResp)
                    cdp.off('Network.responseReceived', onResp);
                await cdp.send('Network.disable', {}).catch(() => { });
            }
        }
    }
    catch (error) {
        if (error instanceof FlowError) {
            const extras = error.extras ? `\n${JSON.stringify(error.extras, null, 2)}` : '';
            return {
                isError: true,
                content: [{ type: 'text', text: `[${error.code}] ${error.message}${extras}` }],
            };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return {
            isError: true,
            content: [{ type: 'text', text: `flow 실패: ${msg}` }],
        };
    }
}
async function waitForPageLoad(cdp, timeoutMs) {
    const end = Date.now() + timeoutMs;
    // navigate 직후에는 이전 문서의 readyState가 'complete'로 남아있을 수 있어 잠깐 대기
    await new Promise((r) => setTimeout(r, 300));
    while (Date.now() < end) {
        try {
            const res = (await cdp.send('Runtime.evaluate', {
                expression: 'document.readyState',
                returnByValue: true,
            }));
            if (res.result.value === 'complete')
                return;
        }
        catch {
            // 네비게이션 중 실행 컨텍스트 파괴 — 재시도
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new FlowError(ErrorCode.WAIT_TIMEOUT, `페이지 로드가 ${timeoutMs}ms 내에 완료되지 않았습니다.`);
}
//# sourceMappingURL=flow.js.map