/** Minimal leveled logger: one line per event, `key=value` fields, UTC timestamps. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = 'info';
export const setLogLevel = (level: Level) => {
  threshold = level;
};

const fmt = (fields: Record<string, unknown>) =>
  Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v)}`)
    .join(' ');

const emit = (level: Level, scope: string, msg: string, fields: Record<string, unknown> = {}) => {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg} ${fmt(fields)}`.trimEnd();
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
};

export const logger = (scope: string) => ({
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', scope, msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', scope, msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', scope, msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', scope, msg, f),
});

export type Logger = ReturnType<typeof logger>;
