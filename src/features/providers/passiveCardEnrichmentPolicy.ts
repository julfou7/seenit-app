export const PASSIVE_CARD_FAILURE_RETRY_MS = 5 * 60 * 1000;

export interface PassiveCardEnrichmentGate {
  tryStart: (key: string, now?: number) => boolean;
  succeed: (key: string) => void;
  fail: (key: string, now?: number) => void;
}

export function createPassiveCardEnrichmentGate(maxFailures = 240): PassiveCardEnrichmentGate {
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();

  const trimFailures = () => {
    while (failures.size > maxFailures) {
      const oldestKey = failures.keys().next().value;
      if (typeof oldestKey !== 'string') break;
      failures.delete(oldestKey);
    }
  };

  return {
    tryStart(key, now = Date.now()) {
      if (inFlight.has(key)) return false;

      const failedAt = failures.get(key);
      if (failedAt !== undefined && now - failedAt < PASSIVE_CARD_FAILURE_RETRY_MS) {
        return false;
      }

      failures.delete(key);
      inFlight.add(key);
      return true;
    },
    succeed(key) {
      inFlight.delete(key);
      failures.delete(key);
    },
    fail(key, now = Date.now()) {
      inFlight.delete(key);
      failures.delete(key);
      failures.set(key, now);
      trimFailures();
    },
  };
}
