export const PLEX_AVAILABILITY_TRACE_STAGES = [
  'dispatch',
  'fcm_received',
  'work_enqueue',
  'worker',
  'credentials',
  'identity',
  'input',
  'plex_check',
  'notification',
] as const;

export const PLEX_AVAILABILITY_TRACE_OUTCOMES = [
  'fcm_accepted',
  'fcm_failed',
  'no_capable_device',
  'received',
  'enqueued',
  'started',
  'missing_retry',
  'missing_exhausted',
  'uid_mismatch',
  'invalid_payload',
  'available',
  'not_available_retry',
  'not_available_exhausted',
  'error_retry',
  'error_exhausted',
  'shown',
  'disabled',
  'security_error',
] as const;

export type PlexAvailabilityTraceStage = typeof PLEX_AVAILABILITY_TRACE_STAGES[number];
export type PlexAvailabilityTraceOutcome = typeof PLEX_AVAILABILITY_TRACE_OUTCOMES[number];

export interface PlexAvailabilityTraceEvent {
  traceId: string;
  stage: PlexAvailabilityTraceStage;
  outcome: PlexAvailabilityTraceOutcome;
  attempt: number;
  timestamp: number;
}

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_EVENTS = 120;
const STAGES = new Set<string>(PLEX_AVAILABILITY_TRACE_STAGES);
const OUTCOMES = new Set<string>(PLEX_AVAILABILITY_TRACE_OUTCOMES);

export function normalizePlexAvailabilityTraceBatch(value: unknown): PlexAvailabilityTraceEvent[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { schemaVersion?: unknown; events?: unknown };
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.events)) return null;
  if (candidate.events.length === 0 || candidate.events.length > MAX_EVENTS) return null;

  const events: PlexAvailabilityTraceEvent[] = [];
  for (const raw of candidate.events) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const traceId = String(item.traceId || '').trim();
    const stage = String(item.stage || '').trim();
    const outcome = String(item.outcome || '').trim();
    const attempt = Number(item.attempt);
    const timestamp = Number(item.timestamp);
    if (
      !UUID_PATTERN.test(traceId)
      || !STAGES.has(stage)
      || !OUTCOMES.has(outcome)
      || !Number.isInteger(attempt)
      || attempt < 0
      || attempt > 12
      || !Number.isFinite(timestamp)
      || timestamp < 1
      || timestamp > Number.MAX_SAFE_INTEGER
    ) return null;
    events.push({
      traceId,
      stage: stage as PlexAvailabilityTraceStage,
      outcome: outcome as PlexAvailabilityTraceOutcome,
      attempt,
      timestamp: Math.floor(timestamp),
    });
  }
  return events;
}
