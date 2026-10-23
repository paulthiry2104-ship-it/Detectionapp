import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema.ts';

export type Row = Record<string, any>;

/** Petite surcouche synchrone sur node:sqlite (aucune dépendance native à compiler). */
export class Db {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec(SCHEMA);
  }
  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.raw.close();
  }
}

let instance: Db | null = null;
export function getDb(path?: string): Db {
  if (!instance) {
    if (!path) throw new Error('getDb: chemin requis au premier appel');
    instance = new Db(path);
  }
  return instance;
}
export function setDb(db: Db | null) {
  instance = db;
}

export const nowIso = () => new Date().toISOString();
export const j = (v: unknown) => JSON.stringify(v ?? null);
export const pj = <T = any>(s: string | null | undefined, fallback: T): T => {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
/** Convertit undefined/NaN en null pour SQLite. */
export const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
export const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
