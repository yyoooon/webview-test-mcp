import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { definition as connectDef, handler as connectHandler } from './tools/connect.js';
import { definition as screenshotDef, handler as screenshotHandler } from './tools/screenshot.js';
import { definition as domDef, handler as domHandler } from './tools/dom.js';
import {
  clickDefinition,
  typeDefinition,
  clickHandler,
  typeHandler,
} from './tools/interact.js';
import { definition as evaluateDef, handler as evaluateHandler } from './tools/evaluate.js';
import { definition as waitDef, handler as waitHandler } from './tools/wait.js';
import { state } from './state.js';
import { removeForward } from './adb.js';

const INSTRUCTIONS = `이 서버는 Android WebView 자동화 툴입니다. 불필요한 왕복을 피하기 위해 다음 원칙을 반드시 지키세요.

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

## 3. webview_screenshot은 "사람 눈으로 확인해야 할 때"만
- 기능/상태 검증에는 절대 쓰지 마세요 (원칙 1, 2로 대체)
- 사용할 때는 반드시 selector 옵션으로 element-scoped 캡처
- 풀스크린은 레이아웃 전반 QA에서만 (드물게)

## 4. 순서
클릭/입력이 많은 시나리오는 webview_get_dom으로 한 번 구조 파악 → webview_evaluate로 체이닝 실행 → 필요 시 element-scoped screenshot. webview_click/type은 단발성 조작에만 사용.`;

const server = new Server(
  { name: 'webview-test', version: '1.0.0' },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

const tools = [connectDef, screenshotDef, domDef, clickDefinition, typeDefinition, evaluateDef, waitDef];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'webview_connect':
      return await connectHandler(args as any);
    case 'webview_screenshot':
      return await screenshotHandler(args as any);
    case 'webview_get_dom':
      return await domHandler();
    case 'webview_click':
      return await clickHandler(args as any);
    case 'webview_type':
      return await typeHandler(args as any);
    case 'webview_evaluate':
      return await evaluateHandler(args as any);
    case 'webview_wait_for':
      return await waitHandler(args as any);
    default:
      return {
        isError: true as const,
        content: [{ type: 'text' as const, text: `알 수 없는 도구: ${name}` }],
      };
  }
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (state.cdp) state.cdp.close();
  if (state.forwardedPort) await removeForward(state.forwardedPort).catch(() => {});
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
