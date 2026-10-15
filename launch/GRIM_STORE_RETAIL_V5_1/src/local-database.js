import { DatabaseSync } from 'node:sqlite';

// Local compatibility cache only. Customer, payment and wallet records stay in Supabase.
export default class LocalDatabase extends DatabaseSync {
  pragma(value) { return this.exec(`PRAGMA ${value}`); }
  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try { const result = fn(...args); this.exec('COMMIT'); return result; }
      catch (error) { this.exec('ROLLBACK'); throw error; }
    };
  }
}
