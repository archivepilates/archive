const schema = 'archive_help_member_auth';
const kinds = new Set([
  'binding', 'member-index', 'invite', 'invite-index', 'challenge', 'flow', 'credential',
  'credential-index', 'session', 'budget', 'otp', 'otp-budget', 'otp-receipt',
]);
const validKey = (kind, key) =>
  kinds.has(kind) && typeof key === 'string' && key.length === 64 && /^[a-f0-9]+$/.test(key);
const validTime = (now) => Number.isSafeInteger(now) && now >= 0;
const storeError = (code, message) => Object.assign(new Error(message), { code });
const unavailable = () => storeError('AUTH_STORE_UNAVAILABLE', 'Auth store unavailable');
const unknownCommit = () =>
  storeError('AUTH_STORE_COMMIT_UNKNOWN', 'Auth store commit not confirmed; do not retry');

// A dedicated pg-compatible pool is supplied and owned by the caller. Configure
// connection and transport timeouts there; SQL timeouts below bound server work.
export function createPostgresAuthStore({ pool } = {}) {
  if (typeof pool?.connect !== 'function') throw new TypeError('Dedicated auth pool required');

  async function transaction(run) {
    if (typeof run !== 'function') throw new TypeError('Transaction callback required');
    let client;
    try {
      client = await pool.connect();
    } catch {
      throw unavailable();
    }

    let phase = 'opening';
    let discard = false;
    let active = false;
    let failed = false;
    let pending = 0;
    const query = async (sql, params) => {
      try {
        return await client.query(sql, params);
      } catch {
        // PostgreSQL errors can contain bound values. Do not attach the cause.
        throw unavailable();
      }
    };
    const operation = (fn) => (...args) => {
      const result = (async () => {
        if (!active || failed) throw unavailable();
        pending++;
        try {
          return await fn(...args);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          pending--;
        }
      })();
      // Outstanding calls must not outlive a commit or reject unhandled.
      void result.catch(() => {});
      return result;
    };
    const tx = Object.freeze({
      read: operation(async (kind, key, now) => {
        if (!validKey(kind, key)) return null;
        if (!validTime(now)) throw new TypeError('Invalid auth store time');
        const { rows } = await query(
          `SELECT ${schema}.read_record($1::text, $2::text, $3::bigint) AS value`, [kind, key, now],
        );
        if (rows?.length !== 1) throw unavailable();
        const { value } = rows[0];
        if (value === null) return null;
        if (typeof value !== 'string' || Buffer.byteLength(value) > 12000) throw unavailable();
        try {
          return JSON.parse(value);
        } catch {
          throw unavailable();
        }
      }),
      put: operation(async (kind, key, data, expires = null) => {
        if (!validKey(kind, key) || (expires !== null && (!validTime(expires) || expires === 0))) {
          throw new TypeError('Invalid auth record');
        }
        let value;
        try {
          value = JSON.stringify(data);
        } catch {
          throw new TypeError('Invalid auth record value');
        }
        if (!value || Buffer.byteLength(value) > 12000) throw new TypeError('Invalid auth record size');
        await query(
          `SELECT ${schema}.put_record($1::text, $2::text, $3::text, $4::bigint)`, [kind, key, value, expires],
        );
      }),
      remove: operation(async (kind, key) => {
        if (validKey(kind, key)) {
          await query(`SELECT ${schema}.remove_record($1::text, $2::text)`, [kind, key]);
        }
      }),
      prune: operation(async (now) => {
        if (!validTime(now)) throw new TypeError('Invalid auth store time');
        await query(`SELECT ${schema}.prune_records($1::bigint)`, [now]);
      }),
    });

    try {
      if ((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command !== 'BEGIN') throw unavailable();
      phase = 'working';
      await query("SET LOCAL statement_timeout = '3s'");
      await query("SET LOCAL lock_timeout = '750ms'");
      await query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      await query('SET LOCAL search_path = pg_catalog, pg_temp');
      await query('SET LOCAL ROLE archive_help_member_auth_runtime');
      await query('SELECT pg_catalog.pg_advisory_xact_lock(1095910216, 1212501072)');
      active = true;
      const result = await run(tx);
      active = false;
      if (failed || pending !== 0) throw unavailable();
      phase = 'committing';
      if ((await query('COMMIT')).command !== 'COMMIT') throw unavailable();
      phase = 'committed';
      return result;
    } catch (error) {
      active = false;
      discard = phase !== 'working';
      try {
        if ((await query('ROLLBACK')).command !== 'ROLLBACK') discard = true;
      } catch {
        discard = true;
      }
      throw phase === 'committing' ? unknownCommit() : error;
    } finally {
      try {
        client.release(discard);
      } catch {
        throw phase === 'committing' || phase === 'committed' ? unknownCommit() : unavailable();
      }
    }
  }

  return Object.freeze({
    read: async (kind, key, now) => validKey(kind, key) ? transaction((tx) => tx.read(kind, key, now)) : null,
    transaction,
  });
}
