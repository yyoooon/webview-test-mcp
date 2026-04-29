# webview-test-mcp

Android WebView 자동화용 MCP(Model Context Protocol) 서버. ADB + Chrome DevTools Protocol(CDP)로 실기기의 WebView에 붙어 DOM 조작, JS 실행, 스크린샷을 수행합니다.

실기기 WebView에서 기능을 빠르게 검증하고 싶을 때 사용합니다.

## 요구 사항

- Node.js ≥ 18
- ADB (Android Platform Tools)
- 디버그 빌드 Android 앱 (`WebView.setWebContentsDebuggingEnabled(true)`)
- USB 또는 Wi-Fi로 연결된 Android 기기

## 설치 & 빌드

```bash
yarn install   # or npm install
yarn build     # tsc → dist/
```

## MCP 설정

클라이언트(`.mcp.json` 등)에 등록:

```json
{
  "mcpServers": {
    "webview-test": {
      "command": "node",
      "args": ["/absolute/path/to/webview-test-mcp/dist/index.js"]
    }
  }
}
```

개발 중에는 `command: "tsx"`, `args: ["src/index.ts"]` 로도 실행 가능합니다.

## 제공 툴

| Tool | 설명 |
|------|------|
| `webview_connect` | ADB로 기기를 붙이고 WebView 타겟을 찾아 CDP 세션 생성 |
| `webview_get_dom` | 현재 페이지의 DOM 구조를 가져와 탐색용으로 반환 |
| `webview_evaluate` | 임의 JS 표현식 실행 후 결과 반환 (async 지원) |
| `webview_click` | selector/text로 엘리먼트 클릭 |
| `webview_type` | input/textarea에 값 입력 |
| `webview_wait_for` | 셀렉터/조건이 만족될 때까지 대기 |
| `webview_screenshot` | 풀스크린 또는 selector-scoped 캡처 |

## 사용 원칙

불필요한 MCP 왕복을 피하기 위해 다음 원칙을 지킵니다.

1. **기능 검증은 `webview_evaluate` 중심으로 체이닝.** 여러 번의 click/screenshot 대신 한 번의 evaluate 안에서 async로 묶어 실행합니다.
2. **스타일 검증은 스크린샷 대신 계산된 값.** `getComputedStyle`, `classList`, `getBoundingClientRect` 를 JSON으로 뽑아냅니다.
3. **`webview_screenshot` 은 사람 눈 확인용.** 기능 검증에는 쓰지 않고, 쓸 때도 selector 옵션으로 element-scoped 캡처를 권장합니다.
4. **순서.** `get_dom` 으로 구조 파악 → `evaluate` 로 체이닝 실행 → 필요 시 element-scoped screenshot. 단발성 조작에만 `click/type` 사용.
5. **요구사항 미충족 시 자동 반복.** 한 라운드 실행 결과가 요구사항과 어긋나면 사용자에게 다시 묻지 말고 코드 수정 → HMR 반영 대기 → 동일 시나리오 재실행을 2~3회까지 자동으로 굴립니다. 같은 부분에서 막히거나 요구사항이 모호해질 때만 멈추고 보고합니다.

자세한 동작 흐름은 `docs/` 아래 설계 스펙을 참고하세요.

## webview_flow (선언형 시나리오)

multi-step 시나리오를 한 콜로 묶을 때 사용. JS를 직접 작성할 필요 없음.

### Step 종류

- `{ click: Selector }` — 가시 요소 클릭
- `{ type: { selector, text } }` — 입력
- `{ waitFor: WaitCond, timeout? }` — 조건 대기 (기본 5000ms)
- `{ sleep: ms }` — 단순 대기
- `{ goto: '/path' }` — pushState + popstate
- `{ capture: CaptureSpec }` — 결과 캡처
- `{ raw: 'JS expr' }` — escape hatch
- `{ assert: { kind, value } }` — 단언

### Selector
- 문자열: CSS selector
- `{ text: 'Confirm', within?: '[role=dialog]', tag?: 'button' }`
- `{ testId: 'cta' }`

### WaitCond
- `{ selector: 'X' }` / `{ gone: 'X' }`
- `{ text: 'X', within?: 'Y' }`
- `{ role: 'dialog' }`
- `{ url: '/path-prefix' }`

### CaptureSpec
- `url`, `scenario`, `toast`: boolean
- `dialog`: `{ buttons?, text?, headings? }`
- `storage`: `{ session?: string[], local?: string[] }`
- `custom`: `{ key: 'JS expression' }`

### 실패 시 자동 첨부
첫 실패 step 발생 시 `snapshot: { url, dialogPresent, visibleButtons, headings }`이 응답에 자동 첨부됨.

### 예시
```json
{
  "steps": [
    { "click": { "text": "Update My Program" } },
    { "waitFor": { "role": "dialog" } },
    { "click": { "text": "Confirm", "within": "[role=dialog]" } },
    { "waitFor": { "gone": "[role=dialog]" } },
    { "capture": { "url": true, "scenario": true } }
  ]
}
```

## 개발

```bash
yarn dev          # tsx로 stdio 서버 실행
yarn test         # vitest (unit)
yarn test:watch   # vitest watch
```

## 라이선스

MIT
