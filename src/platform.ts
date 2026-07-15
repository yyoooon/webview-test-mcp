import { getConnectedDevices } from './adb.js';
import { listIosDevices } from './ios.js';
import { ErrorCode, FlowError } from './errors.js';

export type Platform = 'android' | 'ios';

export function resolvePlatform(androidCount: number, iosCount: number): Platform {
  if (androidCount > 0 && iosCount > 0) throw new FlowError(ErrorCode.PLATFORM_AMBIGUOUS);
  if (androidCount > 0) return 'android';
  if (iosCount > 0) return 'ios';
  throw new FlowError(ErrorCode.NO_DEVICE);
}

export async function detectPlatform(): Promise<Platform> {
  const android = await getConnectedDevices().catch(() => []);
  const ios = listIosDevices();
  return resolvePlatform(android.length, ios.length);
}
