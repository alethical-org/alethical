// Real-user monitoring (RUM) for read-surface latency (#516). Public surface:
// callers instrument a read with `captureRead`; everything else (dimensions,
// sampling, transport) is internal. Collection is OFF unless
// EXPO_PUBLIC_RUM_ENABLED is "true".

export { captureRead } from './capture';
export type { CapturedRead } from './capture';
export type { CacheStatus, DeviceClass, RumEvent, RumInteraction } from './types';
