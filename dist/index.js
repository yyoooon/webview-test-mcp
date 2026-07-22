import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { definition as connectDef, handler as connectHandler } from './tools/connect.js';
import { definition as screenshotDef, handler as screenshotHandler } from './tools/screenshot.js';
import { definition as domDef, handler as domHandler } from './tools/dom.js';
import { clickDefinition, typeDefinition, clickHandler, typeHandler, } from './tools/interact.js';
import { definition as evaluateDef, handler as evaluateHandler } from './tools/evaluate.js';
import { definition as waitDef, handler as waitHandler } from './tools/wait.js';
import { definition as flowDef, flowHandler } from './tools/flow.js';
import { definition as runScriptDef, handler as runScriptHandler } from './tools/run-script.js';
import { state } from './state.js';
import { removeForward } from './adb.js';
import { stopProxy } from './ios.js';
const INSTRUCTIONS = `이 서버는 Android WebView 자동화 툴입니다. 불필요한 왕복을 피하기 위해 다음 원칙을 반드시 지키세요.

## 0. 다중 step 시나리오는 webview_flow 우선
"클릭 → 대기 → 캡처" 같은 multi-step 시나리오는 webview_flow의 선언형 step 배열로 1콜에 묶으세요. JS를 직접 작성할 필요 없고, 실패 시 자동 snapshot이 첨부되어 다음 시도의 selector를 알려줍니다.

예시:
  webview_flow({
    steps: [
      { click: { text: 'Update My Program' } },
      { waitFor: { role: 'dialog' } },
      { click: { text: 'Confirm', within: '[role=dialog]' } },
      { waitFor: { gone: '[role=dialog]' } },
      { capture: { url: true, scenario: true } }
    ]
  })

webview_evaluate는 flow가 표현하지 못하는 케이스 (성능 측정, 복잡한 DOM 트래버설)의 escape hatch로만 사용.

## 1. 기능 검증은 webview_evaluate 중심으로
여러 상호작용을 연속으로 할 때는 webview_click을 여러 번 호출하지 말고, webview_evaluate 한 번 안에서 체이닝하세요.

예시 (나쁨: 3콜):
  webview_click({ selector: '#profile' })
  webview_click({ text: 'Run Program' })
  webview_screenshot()

예시 (좋음: 1콜):
  webview_evaluate({ expression: \`
    (async () => {
      document.querySelector('#profile').click();
      await new Promise(r => setTimeout(r, 50));
      [...document.querySelectorAll('[role=menuitem]')]
        .find(el => el.textContent.trim() === 'Run Program').click();
      await new Promise(r => setTimeout(r, 100));
      return {
        bannerTitle: document.querySelector('[data-testid=banner-title]')?.textContent,
        route: location.pathname,
      };
    })()
  \` })

## 2. 스타일 검증은 이미지 대신 계산된 값으로
webview_evaluate로 getComputedStyle / classList / getBoundingClientRect 를 뽑아내면 스크린샷보다 10~100배 빠르고 토큰도 거의 안 듭니다.

예시:
  webview_evaluate({ expression: \`
    const el = document.querySelector('[data-testid=cta]');
    JSON.stringify({
      bg: getComputedStyle(el).backgroundColor,
      size: el.getBoundingClientRect(),
      classes: [...el.classList],
    })
  \` })

## 2-1. **디자인 적용 검증은 webview_flow의 inspect step**
Figma spec과 화면 비교 시: \`goto → waitFor → inspect\`를 **1콜로 묶어서** 여러 selector의 computed style/text/classList/rect를 한 번에 뽑으세요. JS 직접 작성 불필요.

예시 (디자인 1차 적용 후 검증):
  webview_flow({
    steps: [
      { goto: '/onboarding' },
      { waitFor: { selector: 'main h1' } },
      {
        inspect: {
          title: { selector: 'h1', style: ['fontSize', 'fontWeight', 'lineHeight'], text: true },
          badgeNumber: { selector: 'p span:first-child', style: ['fontWeight', 'color'] },
          badgeLabel: { selector: 'p span:last-child', style: ['fontWeight'] },
          backIcon: { selector: '[aria-label=뒤로가기] svg', rect: ['width', 'height'] },
          ctaButton: { selector: 'button[type=button]:last-of-type', style: ['backgroundColor', 'borderRadius'] }
        }
      }
    ]
  })

응답: \`captured.inspect.title = { fontSize: '24px', fontWeight: '500', text: 'Check what matters\\nright away' }\` 형태로 평탄하게 반환. Figma spec과 즉시 비교해서 다른 수치만 코드 수정 → 다시 같은 flow로 재검증.

## 2-2. **OS-level 터치는 webview_flow의 osTap step**
WebView가 합성 click 이벤트로 띄우지 못하는 케이스 (모바일 키보드/IME, 일부 네이티브 인풋, 스크롤 hijack 등)에 사용. selector로 좌표를 뽑아 ADB \`shell input tap\`을 실행해 진짜 OS-level 터치 이벤트를 발생시킵니다. 일반 click이 동작하면 그걸 쓰고, 키보드 안 뜨는 등의 escape hatch로만 osTap 사용.

예시 (input 포커스 시 키보드가 안 뜰 때):
  webview_flow({
    steps: [
      { waitFor: { selector: '#search-input' } },
      { osTap: '#search-input' },
      { sleep: 300 },
      { type: { selector: '#search-input', text: 'foo' } }
    ]
  })

offset 지원: \`{ osTap: { selector: '#btn', offsetX: 0, offsetY: -10 } }\`. 좌표는 \`devicePixelRatio\`로 자동 스케일링. WebView가 화면 원점에서 시작한다고 가정 (status bar offset 없는 fullscreen WebView 기준).

## 2-3. 스크롤 — scroll(JS) vs osSwipe(ADB)
- 요소가 DOM에 이미 있고 스크롤만 필요 → \`{ scroll: { to: '#target' } }\` 또는 \`{ scroll: { by: { y: 500 } } }\` (container 옵션으로 내부 스크롤 영역 지정).
- 무한스크롤/pull-to-refresh/네이티브 제스처가 필요 → \`{ osSwipe: { direction: 'up' } }\` (ADB input swipe, direction은 손가락 이동 방향 — up이면 아래 콘텐츠가 드러남).

## 2-4. OS 키 이벤트는 osKey step
Android Back 버튼 검증, 검색 Enter 제출 등: \`{ osKey: 'BACK' }\`, \`{ osKey: 'ENTER' }\` (type step 뒤에). ADB keyevent로 실행되므로 진짜 OS 이벤트.

## 2-5. 네비게이션 — goto 문자열 vs 객체
- SPA 클라이언트 라우팅(같은 앱 내 이동): \`{ goto: '/path' }\` (pushState, 기존 동작).
- 새로고침/딥링크/다른 origin: \`{ goto: { url: '...', timeout?: 10000 } }\` 또는 \`{ goto: { reload: true } }\` — CDP Page.navigate/reload 후 load 완료까지 자동 대기.

## 2-6. flow 실패 진단은 console 필드부터
flow 결과에 \`console\` 필드가 있으면 실행 중 발생한 JS 에러/console.error/warning 목록입니다. 실패 원인의 절반은 DOM이 아니라 JS 에러 — snapshot보다 먼저 확인하세요.

## 2-7. transient(깜빡임) 검증은 appearsThenGone
순간 떴다 사라지는 UI(유도 팝업 flicker 등)는 최종 상태로 판정 불가 — 중간 노출을 잡아야 합니다. \`{ waitFor: { appearsThenGone: '#popup', windowMs: 2000 } }\`가 windowMs 동안 샘플링해 \`observed: { appeared, wentGone, hits }\`를 기록합니다. flow를 중단하지 않는 관찰용 step. "깜빡이면 안 됨" 회귀 = \`appeared:false\` 기대.

## 2-8. 지연 네트워크는 waitFor network로 완료 대기
클릭 → 애니메이션(Lottie 등) 콜백 뒤 POST 되는 구조는 클릭 직후 상태조회하면 아직 요청 전이라 오판합니다. \`{ waitFor: { network: 'POST /gourd/throw', timeout: 10000 } }\`로 해당 요청의 response 수신까지 대기한 뒤 상태를 조회하세요. \`method + url 부분일치\`로 매칭, 타임아웃 시 \`observed\`에 그동안 관측된 요청 목록 첨부. netwait step이 있으면 flow 시작 시점부터 요청을 버퍼링하므로 앞선 click이 유발한 요청도 놓치지 않습니다.

## 2-9. goto 문자열 + Next.js = 화면 안 바뀔 수 있음
\`{ goto: '/path' }\`(pushState)는 Next.js App Router가 라우팅 신호로 안 받아 주소만 바뀌고 화면은 그대로일 수 있습니다. goto 결과 mark에 \`warn: 'NEXTJS_SOFT_NAV'\`가 뜨면 화면 전환이 필요한 경우 \`{ goto: { url } }\`(hard-nav) 또는 실제 버튼 클릭을 쓰세요.

## 3. webview_screenshot은 "사람 눈으로 확인해야 할 때"만
- 기능/상태 검증에는 절대 쓰지 마세요 (원칙 1, 2로 대체)
- 사용할 때는 반드시 selector 옵션으로 element-scoped 캡처
- 풀스크린은 레이아웃 전반 QA에서만 (드물게)

## 4. 순서
클릭/입력이 많은 시나리오는 webview_get_dom으로 한 번 구조 파악 → webview_evaluate로 체이닝 실행 → 필요 시 element-scoped screenshot. webview_click/type은 단발성 조작에만 사용.

매크로 변형 실행은 스크립트 복제 대신 \`webview_run_script({ name, args: {...} })\` — 스크립트에서 __args로 참조.

## 5. 요구사항 미충족 시 자동 반복
한 라운드 실행 결과가 요구사항과 어긋나면 사용자에게 다시 묻지 말고 코드 수정 → HMR 반영 대기 → 동일 시나리오 재실행을 2~3회까지 자동으로 굴립니다. 같은 부분에서 막히거나 요구사항이 모호해질 때만 멈추고 보고합니다.

## 6. 디바이스 선택 절차
\`webview_connect\` 호출 전에 \`adb devices\`로 device 상태 기기 개수를 1회 확인하세요.

- 1대: 조용히 진행 (추가 확인 불필요)
- 2대 이상: Wi-Fi 디바이스(\`IP:port\` 형태) 우선 사용. Wi-Fi가 없으면 사용자에게 목록 제시 + 선택 질문
- 0대: ADB 상태 확인 안내 (재연결 필요)

같은 세션에서 이미 연결돼 있으면 재체크 불필요. WebView가 여러 개면 socketIndex(숫자) 대신 \`webview_connect({ app: 'com.huray' })\`처럼 패키지명 부분 일치로 선택 가능.

## 7. 에러 진단
\`webview_*\` 툴이 \`isError: true\`를 반환하면 에러 문자열만 그대로 사용자에게 전달하지 말고, 한 줄 진단 + 1~2개 구체 액션을 함께 제시하세요. 자동 재시도/재탐색 금지 (selector drift, timeout 등은 사용자 판단 영역).

| 에러 (부분 일치) | 원인 | 다음 액션 |
|---|---|---|
| \`기기가 연결되어 있지 않습니다\` | ADB에 device 상태 기기 없음 | \`adb devices\` 결과 보여주기 + 재연결 절차 안내 (Wi-Fi면 \`adb connect <ip>\`, USB면 케이블/USB 디버깅 체크) |
| \`WebView를 찾을 수 없습니다\` | \`webview_devtools_remote_*\` 소켓 없음 | 1) 앱 실행 중인지 묻기 2) **디버그 빌드** 여부 확인 (\`setWebContentsDebuggingEnabled(true)\` 필요). 네이티브 빌드 영역은 사용자에게 넘김 |
| \`WebView가 N개 발견되었습니다\` | 한 앱에 WebView 여러 개 | 반환된 목록을 사용자에게 보여주고 \`socketIndex\` 선택 요청 |
| \`요소를 찾을 수 없습니다\` (click/type) | selector 매칭 실패 | 응답의 \`similar\` 힌트 노출 + 바로 \`webview_get_dom\` 1회 호출로 현재 DOM 제시 → 사용자와 selector 재협의 |
| \`시간 초과 (Nms): ... 미발견\` (wait_for) | 조건 미충족 | 해당 시점 DOM 또는 \`webview_evaluate\`로 상태 찍어보기. 네트워크 대기면 timeout 상향 제안, 클라이언트 로직이면 React Query 상태 등 확인 |

선행조건 문제(ADB 미연결, 디버그 빌드 미적용)는 자동 해결 시도하지 말고 사용자에게 넘기세요. 매크로 재생 중 실패는 해당 단계까지의 snapshot까지만 리포트하고 멈춥니다.`;
const server = new Server({ name: 'webview-test', version: '1.4.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
const tools = [connectDef, screenshotDef, domDef, clickDefinition, typeDefinition, evaluateDef, waitDef, flowDef, runScriptDef];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case 'webview_connect':
            return await connectHandler(args);
        case 'webview_screenshot':
            return await screenshotHandler(args);
        case 'webview_get_dom':
            return await domHandler();
        case 'webview_click':
            return await clickHandler(args);
        case 'webview_type':
            return await typeHandler(args);
        case 'webview_evaluate':
            return await evaluateHandler(args);
        case 'webview_wait_for':
            return await waitHandler(args);
        case 'webview_flow':
            return await flowHandler(args);
        case 'webview_run_script':
            return await runScriptHandler(args);
        default:
            return {
                isError: true,
                content: [{ type: 'text', text: `알 수 없는 도구: ${name}` }],
            };
    }
});
// Cleanup on exit
process.on('SIGINT', async () => {
    if (state.cdp)
        state.cdp.close();
    if (state.forwardedPort)
        await removeForward(state.forwardedPort).catch(() => { });
    stopProxy();
    process.exit(0);
});
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map