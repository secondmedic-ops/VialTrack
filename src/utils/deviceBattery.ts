/**
 * Real-Time Device Battery API Integration
 * Reads live battery percentage and charging status from the browser/device Battery API (navigator.getBattery)
 * and provides real-time event subscriptions and cache for GPS telemetry broadcasts.
 */

export interface DeviceBatteryInfo {
  level: number; // 0 - 100
  isCharging: boolean;
  supported: boolean;
}

let cachedBatteryInfo: DeviceBatteryInfo = {
  level: 95,
  isCharging: false,
  supported: false
};

let batteryPromise: Promise<any> | null = null;
const listeners = new Set<(info: DeviceBatteryInfo) => void>();

// Initialize battery manager if supported
if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
  try {
    batteryPromise = (navigator as any).getBattery();
    batteryPromise?.then((battery: any) => {
      if (!battery) return;

      const updateFromBattery = () => {
        const level = typeof battery.level === 'number' ? Math.round(battery.level * 100) : 95;
        const isCharging = Boolean(battery.charging);
        cachedBatteryInfo = {
          level,
          isCharging,
          supported: true
        };
        listeners.forEach((fn) => fn(cachedBatteryInfo));
      };

      updateFromBattery();

      battery.addEventListener('levelchange', updateFromBattery);
      battery.addEventListener('chargingchange', updateFromBattery);
    }).catch(() => {
      // Ignored if device security policy restricts Battery API
    });
  } catch (_) {}
}

/**
 * Get the current real-time device battery info
 */
export async function getLiveBatteryInfo(): Promise<DeviceBatteryInfo> {
  if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
    try {
      if (!batteryPromise) {
        batteryPromise = (navigator as any).getBattery();
      }
      const battery = await batteryPromise;
      if (battery && typeof battery.level === 'number') {
        const level = Math.round(battery.level * 100);
        const isCharging = Boolean(battery.charging);
        cachedBatteryInfo = {
          level,
          isCharging,
          supported: true
        };
        return cachedBatteryInfo;
      }
    } catch (_) {}
  }
  return cachedBatteryInfo;
}

/**
 * Synchronous getter returning the latest cached battery level
 */
export function getCachedBatteryLevel(): number {
  return cachedBatteryInfo.level;
}

/**
 * Synchronous getter returning whether device is charging
 */
export function getCachedIsCharging(): boolean {
  return cachedBatteryInfo.isCharging;
}

/**
 * Subscribe to live battery changes (e.g. rider plugs in charger or drops 1%)
 */
export function subscribeToBatteryChanges(callback: (info: DeviceBatteryInfo) => void): () => void {
  listeners.add(callback);
  callback(cachedBatteryInfo);
  // Also refresh asynchronously
  getLiveBatteryInfo().then((info) => callback(info)).catch(() => {});

  return () => {
    listeners.delete(callback);
  };
}
