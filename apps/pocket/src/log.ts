/**
 * The app's only way to write to the log, and it refuses what must never
 * be in one: tokens, passwords, installation and document ids, titles,
 * names, addresses. A field with such a name is withheld whatever its
 * value, and a value that looks like a token or an id is withheld whatever
 * its field is called. Release and preview builds strip every console
 * call but console.error (babel.config.js); this is for dev builds and for
 * the errors that stay.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const SECRET_FIELD = /token|password|secret|code|authorization|cookie|installation|title|name|email|address|origin|host|url|path|^id$|_id$|Id$/i;
const SECRET_VALUE = [
  /^[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}$/, // JWT-shaped
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // a UUID anywhere
  /^[A-Za-z0-9+/_=-]{32,}$/, // a long opaque token
  /bearer\s/i,
];

export function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_FIELD.test(key)) {
      out[key] = '[withheld]';
    } else if (typeof value === 'string' && SECRET_VALUE.some((re) => re.test(value))) {
      out[key] = '[withheld]';
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.length > 80 ? `${value.slice(0, 80)}…` : value;
    } else {
      out[key] = '[object]';
    }
  }
  return out;
}

export type Sink = (level: Level, event: string, fields: Record<string, unknown>) => void;

// One call per level, written out: the build step that strips console
// calls from preview and release builds keeps console.error, and it can
// only tell which call that is when the name is spelt out.
let sink: Sink = (level, event, fields) => {
  const line = `[fdv] ${event}`;
  if (level === 'error') console.error(line, fields);
  else if (level === 'warn') console.warn(line, fields);
  else if (level === 'info') console.info(line, fields);
  else console.log(line, fields);
};

/** Tests only. */
export function setSink(next: Sink): void {
  sink = next;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  sink(level, event.replace(/[^a-z0-9_.:-]/gi, '_').slice(0, 60), scrub(fields));
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};
