import { create } from 'zustand';
import { getUserLogStorageKey, sanitizeLogDetails } from '../features/logging/logPrivacy';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';
export type LogCategory = 'plex' | 'tmdb' | 'sync' | 'system' | 'auth';

export interface AppLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: any;
}

interface LogState {
  logs: AppLogEntry[];
  addLog: (categoryOrMsg: any, messageOrLevel?: any, details?: any, level?: LogLevel) => void;
  clearLogs: () => void;
  getLogsAsText: () => string;
}

const LEGACY_STORAGE_KEY = 'app_activity_logs_v1';
const MAX_LOGS = 150;
let activeLogUid: string | null = null;

const loadUserLogs = (uid: string): AppLogEntry[] => {
  try {
    const raw = localStorage.getItem(getUserLogStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_LOGS) : [];
  } catch {
    return [];
  }
};

const saveLogs = (logs: AppLogEntry[]) => {
  if (!activeLogUid) return;
  try {
    localStorage.setItem(getUserLogStorageKey(activeLogUid), JSON.stringify(logs.slice(0, MAX_LOGS)));
  } catch {
    // ignore quota error
  }
};

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],

  addLog: (categoryOrMsg: any, messageOrLevel?: any, details?: any, level: LogLevel = 'info') => {
    let category: LogCategory = 'sync';
    let message: string = '';
    let actualLevel: LogLevel = level;
    let actualDetails = details;

    const validCategories = ['plex', 'tmdb', 'sync', 'system', 'auth'];
    const validLevels = ['info', 'success', 'warn', 'error'];

    if (typeof categoryOrMsg === 'string' && validCategories.includes(categoryOrMsg)) {
      category = categoryOrMsg as LogCategory;
      message = String(messageOrLevel || '');
    } else {
      category = 'sync';
      message = String(categoryOrMsg || '');
      if (typeof messageOrLevel === 'string' && validLevels.includes(messageOrLevel)) {
        actualLevel = messageOrLevel as LogLevel;
      }
    }

    const newEntry: AppLogEntry = {
      id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      timestamp: Date.now(),
      level: actualLevel,
      category,
      message: String(sanitizeLogDetails(message)),
      details: actualDetails ? sanitizeLogDetails(actualDetails) : undefined
    };

    // Also mirror to browser console for easy inspection
    const prefix = `[${category.toUpperCase()}]`;
    if (actualLevel === 'error') {
      console.error(prefix, newEntry.message, newEntry.details || '');
    } else if (actualLevel === 'warn') {
      console.warn(prefix, newEntry.message, newEntry.details || '');
    } else {
      console.log(prefix, newEntry.message, newEntry.details || '');
    }

    set((state) => {
      const updated = [newEntry, ...state.logs].slice(0, MAX_LOGS);
      saveLogs(updated);
      return { logs: updated };
    });
  },

  clearLogs: () => {
    try {
      if (activeLogUid) localStorage.removeItem(getUserLogStorageKey(activeLogUid));
    } catch {}
    set({ logs: [] });
  },

  getLogsAsText: () => {
    const { logs } = get();
    return logs
      .map((l) => {
        const time = new Date(l.timestamp).toLocaleTimeString('fr-FR');
        const date = new Date(l.timestamp).toLocaleDateString('fr-FR');
        const lvl = l.level.toUpperCase().padEnd(7);
        const cat = `[${l.category.toUpperCase()}]`.padEnd(8);
        const detailsStr = l.details ? ` | ${typeof l.details === 'object' ? JSON.stringify(l.details) : l.details}` : '';
        return `[${date} ${time}] ${lvl} ${cat} ${l.message}${detailsStr}`;
      })
      .join('\n');
  }
}));

export function activateLogUserScope(uid?: string | null): void {
  const nextUid = String(uid || '').trim() || null;
  if (nextUid === activeLogUid) return;
  activeLogUid = nextUid;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}
  useLogStore.setState({ logs: nextUid ? loadUserLogs(nextUid) : [] });
}

// Quick helper function for easy logging anywhere
export const appLogger = {
  info: (category: LogCategory, message: string, details?: any) => useLogStore.getState().addLog(category, message, details, 'info'),
  success: (category: LogCategory, message: string, details?: any) => useLogStore.getState().addLog(category, message, details, 'success'),
  warn: (category: LogCategory, message: string, details?: any) => useLogStore.getState().addLog(category, message, details, 'warn'),
  error: (category: LogCategory, message: string, details?: any) => useLogStore.getState().addLog(category, message, details, 'error')
};
