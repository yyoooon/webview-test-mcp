import { getConnectedDevices } from './adb.js';
import { listIosDevices } from './ios.js';
import { ErrorCode, FlowError } from './errors.js';
export function resolvePlatform(androidCount, iosCount) {
    if (androidCount > 0 && iosCount > 0)
        throw new FlowError(ErrorCode.PLATFORM_AMBIGUOUS);
    if (androidCount > 0)
        return 'android';
    if (iosCount > 0)
        return 'ios';
    throw new FlowError(ErrorCode.NO_DEVICE);
}
export async function detectPlatform() {
    const android = await getConnectedDevices().catch(() => []);
    const ios = listIosDevices();
    return resolvePlatform(android.length, ios.length);
}
//# sourceMappingURL=platform.js.map