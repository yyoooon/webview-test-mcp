# WebView Test MCP Server — Design Spec

Android WebView에서 실행되는 front-care-hub를 Claude가 직접 테스트할 수 있게 하는 MCP 서버.

## 배경

front-care-hub는 네이티브 앱의 WebView 안에서 동작하며, `window.CareHubBridge`를 통한 브릿지 통신에 의존한다. 브라우저에서 Playwright로 테스트하면 브릿지가 없어 기능이 불완전하고, 실제 WebView에서의 테스트는 수동으로만 가능했다.

## 목표

- Claude가 실제 Android WebView에 연결해서 UI 확인, 기능 인터랙션, 브릿지 통합 테스트를 수행
- 네이티브 앱 코드 수정 없이 동작
- 기존 ADB 연결 인프라 활용

## 제약 조건

- 네이티브 앱 수정 최소화 (다른 팀 관리)
- Android 물리 기기, ADB 유선/무선 연결 (개발 중 항상 연결)
- 개발 시 WebView는 `localhost:3000`을 로드 (Next.js dev server)
- WebView는 이미 debuggable (chrome://inspect 동작 확인)

## 아키텍처

```
┌─────────────┐     MCP (stdio)     ┌──────────────────────┐
│  Claude Code │ ◄─────────────────► │  webview-test-mcp    │
│              │   tools & results   │  (Node.js)           │
└─────────────┘                     │                      │
                                    │  ┌─────────────────┐ │
                                    │  │ ADB Manager     │ │
                                    │  │ (기기/웹뷰 탐색, │ │
                                    │  │  포트 포워딩)    │ │
                                    │  └────────┬────────┘ │
                                    │           │          │
                                    │  ┌────────▼────────┐ │
                                    │  │ CDP Client      │ │
                                    │  │ (WebSocket)     │ │
                                    │  └─────────────────┘ │
                                    └──────────────────────┘
                                              │
                                        adb forward
                                              │
                                    ┌─────────▼──────────┐
                                    │  Android Device     │
                                    │  ┌────────────────┐ │
                                    │  │ Native App     │ │
                                    │  │ ┌────────────┐ │ │
                                    │  │ │  WebView   │ │ │
                                    │  │ │ (CDP 노출) │ │ │
                                    │  │ └────────────┘ │ │
                                    │  └────────────────┘ │
                                    └────────────────────┘
```

3개 레이어:

- **ADB Manager** — `adb` CLI로 기기 탐색, WebView 프로세스 PID 탐색, `adb forward`로 CDP 포트 포워딩
- **CDP Client** — 포워딩된 포트에 WebSocket으로 연결, Chrome DevTools Protocol 명령 실행
- **MCP Tools** — Claude가 사용할 도구들을 MCP 프로토콜로 노출

기술 스택: Node.js + TypeScript, `@modelcontextprotocol/sdk`, `chrome-remote-interface`

## MCP 도구 (7개)

### 연결

| 도구 | 인자 | 설명 |
|------|------|------|
| `webview_connect` | 없음 (자동 탐색) | 기기의 WebView를 탐색하고 CDP 연결. 기기명, 앱 패키지, 현재 URL 반환 |

### UI 확인

| 도구 | 인자 | 설명 |
|------|------|------|
| `webview_screenshot` | 없음 | 현재 WebView 화면 캡처, PNG base64 반환 (MCP image content type) |
| `webview_get_dom` | 없음 | 보이는 상호작용 가능 요소 스냅샷 반환 (selector, text, tag, visible) |

### 인터랙션

| 도구 | 인자 | 설명 |
|------|------|------|
| `webview_click` | `selector?: string, text?: string` | CSS selector 또는 텍스트 내용으로 요소 찾아 클릭. 둘 다 지정하면 AND 조건. 못 찾으면 유사 요소 제안 |
| `webview_type` | `selector?: string, text?: string, value: string` | selector 또는 텍스트로 요소 찾아 포커스 후 value 입력 |

### JS 실행 & 대기

| 도구 | 인자 | 설명 |
|------|------|------|
| `webview_evaluate` | `expression: string` | WebView에서 JS 실행, 결과 반환. `awaitPromise: true`로 비동기 지원 |
| `webview_wait_for` | `selector?: string, expression?: string, timeout?: number` | selector 출현 또는 JS 조건 만족까지 대기. 기본 10초, 폴링 200ms |

scroll, navigate, bridge call은 `webview_evaluate`로 처리:
- 스크롤: `window.scrollTo(0, document.body.scrollHeight)`
- 네비게이션: `window.location.href = '/survey'`
- 브릿지: `await bridgeClient.requestAuthInfo()`

## 연결 흐름

```
webview_connect 호출
    │
    ▼
adb devices → 연결된 기기 확인
    │
    ▼
adb shell cat /proc/net/unix | grep webview_devtools
    → WebView 소켓 탐색 (webview_devtools_remote_<pid>)
    │
    ▼
소켓이 여러 개면 목록 반환, 하나면 바로 연결
    │
    ▼
빈 포트 자동 할당 후 adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
    │
    ▼
http://localhost:<port>/json/version 으로 CDP 엔드포인트 확인
    │
    ▼
WebSocket 연결 수립
    │
    ▼
연결 성공 — 기기명, 앱 패키지, 현재 URL 반환
```

포트 자동 할당으로 다른 프로세스와 충돌 방지. WebView가 여러 개면 목록을 보여주고 선택하게 함.

## 도구 동작 상세

### webview_screenshot

CDP `Page.captureScreenshot` 호출. WebView 영역만 캡처 (네이티브 UI 제외). base64 PNG → MCP image content type으로 반환.

### webview_get_dom

CDP `Runtime.evaluate`로 DOM 순회. 보이는 상호작용 가능 요소만 반환:

```json
[
  { "selector": "button.btn-primary", "text": "다음", "tag": "button", "visible": true },
  { "selector": "input[name='email']", "text": "", "tag": "input", "type": "email", "visible": true }
]
```

selector 생성 규칙: `id > data-testid > name 속성 > tag + nth-child 조합` 순서로 가장 고유한 selector를 생성. `webview_click`에 바로 넘길 수 있도록 `document.querySelector()`로 유일하게 매칭되는 selector를 보장.

요소가 많으면 잘라서 Claude 컨텍스트 낭비 방지.

### webview_click

selector로 요소를 찾고, `getBoundingClientRect()`로 중심 좌표 계산. CDP `Input.dispatchMouseEvent`로 mousePressed → mouseReleased 시퀀스 실행. 요소를 못 찾으면 에러 + 유사 요소 제안.

### webview_type

해당 요소를 먼저 클릭(포커스) 후 CDP `Input.dispatchKeyEvent`로 키 입력.

### webview_evaluate

CDP `Runtime.evaluate`로 JS 실행. `awaitPromise: true`로 async 코드 지원. 타임아웃 30초.

### webview_wait_for

CDP `Runtime.evaluate`를 200ms 간격으로 폴링. selector 모드는 `document.querySelector(selector) !== null` 체크. function 모드는 주어진 표현식의 truthy 반환 대기. 기본 타임아웃 10초.

## 에러 처리

| 상황 | 동작 |
|------|------|
| ADB 기기 없음 | `"기기가 연결되어 있지 않습니다. adb devices를 확인하세요"` |
| WebView 소켓 없음 | `"WebView를 찾을 수 없습니다. 앱이 실행 중인지 확인하세요"` |
| CDP 연결 끊김 | 다음 도구 호출 시 자동 재연결 1회 시도 → 실패 시 에러 |
| selector로 요소 못 찾음 | 에러 + DOM에서 유사한 요소 목록 제안 |
| evaluate 타임아웃 | `"스크립트 실행 시간 초과"` (30초) |
| wait_for 타임아웃 | `"조건이 만족되지 않았습니다"` + 현재 DOM 상태 힌트 |

모든 에러는 MCP 응답으로 반환. MCP 서버는 크래시하지 않음.

## Claude 사용 워크플로우 예시

```
유저: "온보딩 설문 플로우 테스트해줘"

Claude:
1. webview_connect()
   → "Galaxy S23 연결됨, com.huray.carehub, 현재 URL: http://localhost:3000/"

2. webview_evaluate("window.location.href = '/survey'")
   → 설문 페이지로 이동

3. webview_wait_for({ selector: "[data-testid='survey-step']" })
   → 설문 렌더링 대기

4. webview_screenshot()
   → 첫 화면 확인 ✅

5. webview_get_dom()
   → 선택지 요소 탐색

6. webview_click({ text: "매우 그렇다" })
   → 응답 선택

7. webview_click({ text: "다음" })
   → 다음 스텝

8. webview_screenshot()
   → 두 번째 화면 확인 ✅

... 반복 ...
```

## MCP 서버 등록

Claude Code `settings.json`:

```json
{
  "mcpServers": {
    "webview-test": {
      "command": "node",
      "args": ["path/to/webview-test-mcp/dist/index.js"]
    }
  }
}
```

## 프로젝트 구조

```
webview-test-mcp/
├── src/
│   ├── index.ts          # MCP 서버 엔트리포인트
│   ├── adb.ts            # ADB 명령 래퍼 (기기 탐색, 포트 포워딩)
│   ├── cdp.ts            # CDP WebSocket 연결 & 명령 실행
│   └── tools/
│       ├── connect.ts
│       ├── screenshot.ts
│       ├── dom.ts
│       ├── interact.ts   # click, type
│       ├── evaluate.ts
│       └── wait.ts
├── package.json
└── tsconfig.json
```
