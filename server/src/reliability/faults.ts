export type FaultPoint =
  | 'GET_CURRENT_JOB_BEFORE'
  | 'CHECK_COMPONENT_BEFORE'
  | 'REPORT_EXCEPTION_BEFORE'
  | 'UPDATE_JOB_STATUS_BEFORE'
  | 'REPORT_INVENTORY_DISCREPANCY_BEFORE'
  | 'REVERSE_BEFORE'
  | 'REVERSE_AFTER_MUTATION'
  | 'VERIFY_BEFORE'
  | 'VERIFY_TIMEOUT';

export type ReliabilityFaultConfig = {
  enabled: boolean;
  point?: FaultPoint;
  once?: boolean;
  delayMs?: number;
};

const isAllowed = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.VOICESTRIKE_ENABLE_RELIABILITY_FAULTS === 'true';

let config: ReliabilityFaultConfig = {
  enabled: isAllowed() && Boolean(process.env.VOICESTRIKE_FAULT_POINT),
  point: process.env.VOICESTRIKE_FAULT_POINT as FaultPoint | undefined,
  once: true,
  delayMs: 0,
};

export function faultInjectionAvailable(): boolean {
  return isAllowed();
}

export function getFaultConfig(): ReliabilityFaultConfig {
  return { ...config, enabled: isAllowed() && config.enabled };
}

export function configureFault(next: ReliabilityFaultConfig): ReliabilityFaultConfig {
  if (!isAllowed()) {
    config = { enabled: false };
    return getFaultConfig();
  }
  config = {
    enabled: Boolean(next.enabled),
    point: next.point,
    once: next.once !== false,
    delayMs: Math.max(0, Math.min(Number(next.delayMs ?? 0), 10000)),
  };
  return getFaultConfig();
}

export function clearFault(): void {
  config = { enabled: false };
}

export function consumeFault(point: FaultPoint): ReliabilityFaultConfig | null {
  if (!isAllowed() || !config.enabled || config.point !== point) return null;
  const active = { ...config, enabled: true };
  if (config.once !== false) config = { enabled: false };
  return active;
}
