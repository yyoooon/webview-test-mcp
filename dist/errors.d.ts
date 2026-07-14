export declare enum ErrorCode {
    NO_DEVICE = "NO_DEVICE",
    MULTIPLE_DEVICES = "MULTIPLE_DEVICES",
    NO_WEBVIEW = "NO_WEBVIEW",
    MULTIPLE_WEBVIEWS = "MULTIPLE_WEBVIEWS",
    CDP_FAILED = "CDP_FAILED",
    SELECTOR_NOT_FOUND = "SELECTOR_NOT_FOUND",
    WAIT_TIMEOUT = "WAIT_TIMEOUT",
    JS_ERROR = "JS_ERROR",
    ASSERT_FAILED = "ASSERT_FAILED",
    INVALID_STEP = "INVALID_STEP",
    NOT_CONNECTED = "NOT_CONNECTED"
}
export declare class FlowError extends Error {
    code: ErrorCode;
    extras?: Record<string, unknown>;
    constructor(code: ErrorCode, message?: string, extras?: Record<string, unknown>);
}
export interface FormattedError {
    code: string;
    message: string;
    extras?: Record<string, unknown>;
}
export declare function formatError(code: ErrorCode, extras?: Record<string, unknown>, override?: string): FormattedError;
