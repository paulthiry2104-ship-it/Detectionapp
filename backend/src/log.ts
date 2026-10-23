type Lvl = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Lvl, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = (): number => order[(process.env.LOG_LEVEL as Lvl) ?? 'info'] ?? 20;

function out(level: Lvl, obj: unknown, msg?: string) {
  if (order[level] < min()) return;
  const base = typeof obj === 'string' ? { msg: obj } : { ...(obj as object), msg };
  const line = JSON.stringify({ t: new Date().toISOString(), level, ...base });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const log = {
  debug: (o: unknown, m?: string) => out('debug', o, m),
  info: (o: unknown, m?: string) => out('info', o, m),
  warn: (o: unknown, m?: string) => out('warn', o, m),
  error: (o: unknown, m?: string) => out('error', o, m),
};
