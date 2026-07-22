export type Platform = 'android' | 'ios';
export declare function resolvePlatform(androidCount: number, iosCount: number): Platform;
export declare function detectPlatform(): Promise<Platform>;
