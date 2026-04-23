# webview-test MCP 스크립트화 매크로 — 디자인

**작성일**: 2026-04-22
**작성자**: Claude + yangyoon@huray.net
**목적**: webview-test MCP로 진행하는 수동 테스트 시나리오를 1회차에 자동 스크립트화하고, 2회차부터는 파일 한 번 읽어 재생해서 개발 중 피드백 루프를 빠르게 만든다.

---

## 1. 배경 / 목표

- 이 프로젝트는 Next.js 15 기반 Android WebView 앱이다. 개발자는 기능 수정/구현 후 실기기 WebView에서 동작을 빠르게 확인하고 싶어 한다.
- 지금까지의 방식(매 세션마다 Claude가 DOM 탐색 → evaluate 반복)은 동일 시나리오를 반복할 때 느리고 토큰도 많이 쓴다.
- 이 문서는 **로컬 개발자 매크로**(회귀 테스트 아님)를 설계한다. Playwright 회귀 스펙화는 별도 주제.

### 목표
- 같은 시나리오를 두 번째 이상 돌릴 때 **DOM 탐색/소스 조회 없이** 파일 한 번 읽어 실행.
- 스크립트 생성은 **자동**. 사용자가 별도 "저장해줘" 라고 말하지 않아도 1회차 테스트가 성공적으로 끝나면 자동 저장.
- 파일은 **기능 단위 1개**, 덮어쓰기로 누적 방지.

### 비-목표
- CI 회귀 테스트 아님. Playwright 스펙이 그 역할.
- PASS/FAIL 이분법 판정 아님. 수집한 snapshot 을 Claude 가 읽고 사용자에게 요약 리포트.
- 자동 재탐색/재시도 없음. selector가 깨지면 멈추고 "다시 만들어" 트리거 필요.

---

## 2. 디렉토리 / 파일명 규칙

- **저장 위치**: 프로젝트 루트의 `.webview-scripts/`
- **파일명**: kebab-case, 기능/화면 단위 1파일
  - 예: `profile-menu-scenarios.webview.js`, `survey-step1.webview.js`, `onboarding-login.webview.js`
- **이름 추론**: Claude 가 사용자 첫 요청의 주제에서 자동 추출
  - "프로필 메뉴 시나리오 돌려봐" → `profile-menu-scenarios.webview.js`
- **중복 이름**: 덮어쓰기 (버전 관리 없음, 최신 1개만 유지)
- **확장자**: `.webview.js` (일반 JS와 구분, grep 용이)
- **gitignore 여부**: 보류 (사용자 결정 대기). 기본은 그냥 둠.

---

## 3. 파일 포맷

**구조**: 상단 메타 주석 + 본문은 `webview_evaluate` 에 그대로 붙여넣는 단일 async IIFE.

### 템플릿
```js
// Generated: YYYY-MM-DD
// Topic: <사용자 첫 요청의 한글 요약 — 매칭 힌트>
// Reset: <사전 조건, 없으면 "none">
(async () => {
  // 스냅샷 함수
  const snap = (label) => ({
    label,
    scenarioStep: JSON.parse(sessionStorage.getItem('scenario_step') || '""'),
    url: location.pathname,
    // ... 그 시나리오에서 관심 있는 필드들
  });

  // 폴링 헬퍼 — 고정 sleep 대신 조건 충족까지 대기
  const waitFor = async (check, { timeout = 5000, interval = 50, label = '' } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = check();
      if (v) return v;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`waitFor timeout${label ? ` (${label})` : ''}`);
  };

  // 헬퍼 (필요 시)
  const open = async () => { /* ... */ };
  const click = async (text) => { /* ... */ };

  const results = [];
  // 동작 시퀀스 — 고정 delay 대신 관측 가능한 조건을 기다림
  await click('X');
  await waitFor(() => document.querySelector('[data-sonner-toast]'), { label: 'toast after X' });
  results.push(snap('X'));
  // ...
  return results;
})()
```

### 원칙
1. **Snapshot-only, assertion 없음.** 단계마다 상태를 찍어서 배열로 리턴. Claude가 리턴값을 읽어서 사용자에게 리포트.
2. **Self-contained.** 외부 import/헬퍼 없음. 한 파일로 완결. 재생 시 `evaluate` 한 번에 끝.
3. **상단 주석이 매칭 인덱스.** `Topic:` 에 한글 요약을 박아두면 Claude가 사용자의 자연어 요청과 매칭할 때 이걸 본다.
4. **고정 sleep 금지, 폴링으로 대기.** `setTimeout`으로 일정 시간 쉬지 말고 `waitFor(() => 조건)`으로 관측 가능한 상태 변화(toast 출현, URL 변경, scenarioStep 변화 등)를 기다린다. 이유: 고정 delay는 최악의 경우를 기준으로 잡혀 실제 필요한 시간보다 훨씬 느려진다. 네트워크 호출이 있는 단계는 `timeout: 5000`, 클라이언트 상태만 바뀌는 단계는 `timeout: 1000` 수준.

---

## 4. 1회차 플로우 (생성)

1. 사용자가 웹뷰 테스트 요청 (자연어, 예: "프로필 메뉴 시나리오 돌려봐")
2. Claude: `webview_connect` + 동작 실행 (DOM 탐색 + evaluate 체이닝 — 기존 방식과 동일)
3. **동작이 성공적으로 완료되면** → 실행한 JS 시퀀스를 그대로 파일로 저장
   - 경로: `.webview-scripts/<추론-이름>.webview.js`
   - 상단 주석 자동 채움 (날짜, Topic, Reset)
4. 사용자 리포트 끝에 한 줄 덧붙임: `💾 저장됨: .webview-scripts/<이름>.webview.js`

### 생략/금지
- "저장할까요?" 따로 묻지 않음 (기본 자동)
- 실패한 실행은 저장 안 함 (깨진 스크립트 금지)
- 기존 파일이 있어도 묻지 않고 덮어쓰기

---

## 5. 2회차 이후 플로우 (재생)

1. 사용자: "프로필 메뉴 다시" / "재생" / "돌려봐" (자연어)
2. Claude: `.webview-scripts/` 목록 확인 + 각 파일 상단 `Topic:` 주석 훑어서 매칭
3. 분기:
   - **단일 매칭** → `webview_connect` → `Read` → 파일 내용을 `webview_evaluate` 한 번에 실행 → snapshot 배열 리포트
   - **다중 매칭** → 짧은 목록으로 "어느 거?" 질문
   - **매칭 없음** → "해당 스크립트 없음. 지금 만들까?" → yes면 1회차 플로우로
4. 리턴된 snapshot 을 단계별로 요약 리포트. 이전 실행과 달라진 필드가 있으면 짚어줌.

### 재생 vs 재생성 구분
- "돌려봐 / 테스트해 / 다시" → **재생 (기본)**
- "새로 만들어 / 다시 만들어 / 재생성" → **1회차 플로우** (덮어쓰기)

---

## 6. 에러 / drift / 초기 상태

### 초기 상태
- 기본 가정: **현재 상태에서 시작**. 자동 리셋 안 함.
- 사전 조건 필요하면 `// Reset:` 필드에 기록 (예: `// Reset: sessionStorage.scenario_step = SURVEY`)
- 재생 전 Claude가 그 조건 확인 → 불일치면 사용자에게 경고하고 "그대로 돌릴까?" 확인. **자동 리셋 금지** (사용자 데이터 손상 위험).

### selector / DOM drift
- evaluate 중 예외 발생 → 어느 단계에서 뭘 찾다 실패했는지 리포트, 부분 snapshot 도 함께
- **자동 재탐색/재시도 없음.** 사용자가 "다시 만들어" 로 재생성 트리거

### 약한 drift 신호
- snapshot 필드가 이전 실행과 달라지면 (null이 되거나 값이 다름) → Claude가 리포트에서 짚어줌
- 판단은 사용자가. 자동 차단 안 함.

### 환경 사전 체크
- `webview_connect` 실패 / 현재 URL이 예상과 크게 다름 → 재생 시작 전 사용자에게 확인

---

## 7. 해결된 결정 사항

| # | 결정 | 근거 |
|---|------|------|
| Q1 | 스코프: webview-test MCP 스크립트화 | "빨리빨리 테스트" 목표. Playwright는 별도 트랙. |
| Q2 | 포맷: Raw async JS expression (`.webview.js`) | evaluate 에 그대로 붙여넣을 수 있음 → 재생 시 zero overhead |
| Q3 | 위치: 루트의 `.webview-scripts/` | 프로젝트와 분리, dot-prefix 로 hidden 관례 |
| Q4 | 트리거: 자동 저장 | "매번 물어보기"는 노이즈 증가 |
| Q5 | gitignore | 보류 |

---

## 8. 해결 안 된 / 추후 결정

- **gitignore 포함 여부** (팀 공유 vs 개인 전용) — 사용자 결정 대기
- **이름 추론 실패 시** 의 fallback 규칙 — 일단 다중 매칭 → 사용자 확인으로 해결. 경험 쌓이면 보강.
- **여러 시나리오를 한 파일에 묶을지** (예: profile-menu-survey 와 profile-menu-end-program 분리 vs 1파일) — 일단 1파일 단위, 필요 시 분리.

---

## 9. 다음 단계

이 디자인이 승인되면 `writing-plans` 스킬로 구현 계획을 만든다. 구현 범위 후보:
1. 이 디자인을 **Claude 가 실제로 따르도록** 만드는 장치: feedback 메모리 파일 작성 (`.claude/projects/.../memory/feedback_webview_script_macro.md`)
2. `.webview-scripts/` 디렉토리 생성 + 간단한 README (선택)
3. 기존 대화에서 했던 프로필 메뉴 시나리오를 첫 스크립트로 저장 (선택)
