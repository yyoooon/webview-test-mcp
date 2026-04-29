export enum ErrorCode {
  NO_DEVICE = 'NO_DEVICE',
  MULTIPLE_DEVICES = 'MULTIPLE_DEVICES',
  NO_WEBVIEW = 'NO_WEBVIEW',
  MULTIPLE_WEBVIEWS = 'MULTIPLE_WEBVIEWS',
  CDP_FAILED = 'CDP_FAILED',
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  WAIT_TIMEOUT = 'WAIT_TIMEOUT',
  JS_ERROR = 'JS_ERROR',
  ASSERT_FAILED = 'ASSERT_FAILED',
  INVALID_STEP = 'INVALID_STEP',
  NOT_CONNECTED = 'NOT_CONNECTED',
}

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.NO_DEVICE]:
    'ADB에 연결된 디바이스가 없습니다. Wi-Fi: `adb connect <ip>`, USB: 케이블 + USB 디버깅 활성화 확인.',
  [ErrorCode.MULTIPLE_DEVICES]:
    '디바이스가 여러 개 연결되어 있습니다. Wi-Fi 디바이스(IP:port)가 없으면 명시적 선택 필요.',
  [ErrorCode.NO_WEBVIEW]:
    'WebView 소켓을 찾을 수 없습니다. 앱 실행 + 디버그 빌드(setWebContentsDebuggingEnabled(true)) 확인.',
  [ErrorCode.MULTIPLE_WEBVIEWS]:
    'WebView 소켓이 여러 개입니다. webview_connect로 socketIndex 지정.',
  [ErrorCode.CDP_FAILED]: 'CDP 연결 실패. 포트 점유 또는 프록시 설정 확인.',
  [ErrorCode.SELECTOR_NOT_FOUND]: '요소를 찾을 수 없습니다.',
  [ErrorCode.WAIT_TIMEOUT]: '대기 조건이 시간 내 충족되지 않았습니다.',
  [ErrorCode.JS_ERROR]: 'JS 실행 에러.',
  [ErrorCode.ASSERT_FAILED]: '단언 실패.',
  [ErrorCode.INVALID_STEP]: '알 수 없는 step 형식.',
  [ErrorCode.NOT_CONNECTED]:
    'WebView에 연결되어 있지 않습니다. webview_connect를 먼저 호출하세요.',
};

export class FlowError extends Error {
  code: ErrorCode;
  extras?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, extras?: Record<string, unknown>) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.extras = extras;
  }
}

export interface FormattedError {
  code: string;
  message: string;
  extras?: Record<string, unknown>;
}

export function formatError(
  code: ErrorCode,
  extras?: Record<string, unknown>,
  override?: string,
): FormattedError {
  return {
    code,
    message: override ?? DEFAULT_MESSAGES[code],
    ...(extras ? { extras } : {}),
  };
}
