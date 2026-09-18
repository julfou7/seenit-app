export interface AgeFilterBrowserTraceEntry {
  phase: string;
  traceId?: string;
  generation?: number;
  page?: number;
  maxAge?: number;
  [key: string]: string | number | boolean | null | undefined;
}

const AGE_FILTER_TRACE_BUFFER_MAX = 500;
const TRACE_BUFFER_KEY = '__SEENIT_AGE_TRACE__';
const TRACE_DUMP_KEY = '__SEENIT_AGE_TRACE_DUMP__';

function browserTraceRoot(): any | null {
  if (typeof window === 'undefined') return null;
  return window as any;
}

export function emitAgeFilterBrowserTrace(entry: AgeFilterBrowserTraceEntry): void {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  console.log(`[AgeFilterTrace] ${JSON.stringify(record)}`);

  const root = browserTraceRoot();
  if (!root) return;
  const buffer = Array.isArray(root[TRACE_BUFFER_KEY]) ? root[TRACE_BUFFER_KEY] : [];
  buffer.push(record);
  if (buffer.length > AGE_FILTER_TRACE_BUFFER_MAX) {
    buffer.splice(0, buffer.length - AGE_FILTER_TRACE_BUFFER_MAX);
  }
  root[TRACE_BUFFER_KEY] = buffer;
  root[TRACE_DUMP_KEY] = () => JSON.stringify(buffer, null, 2);
}

export function installAgeFilterBrowserTraceSurface(): void {
  const root = browserTraceRoot();
  if (!root) return;
  emitAgeFilterBrowserTrace({
    phase: 'instrumentation_loaded',
    host: String(root.location?.hostname || '').slice(0, 120),
    bufferMax: AGE_FILTER_TRACE_BUFFER_MAX,
  });
}
