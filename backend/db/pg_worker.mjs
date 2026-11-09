import { workerData, parentPort } from 'node:worker_threads';
import pg from 'pg';

const { Pool } = pg;
const { sab, port, dbConfig } = workerData;
const int32 = new Int32Array(sab);

const pool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[PG-Worker] Pool error:', err.message);
});

port.on('message', async (msg) => {
  try {
    if (msg.type === 'query') {
      const res = await pool.query(msg.sql, msg.params || []);
      port.postMessage({
        ok: true,
        rows: res.rows || [],
        rowCount: res.rowCount || 0,
      });
    } else if (msg.type === 'exec') {
      await pool.query(msg.sql);
      port.postMessage({ ok: true, rowCount: 0 });
    } else if (msg.type === 'close') {
      await pool.end();
      port.postMessage({ ok: true });
    } else {
      port.postMessage({ ok: false, error: 'Unknown message type: ' + msg.type });
    }
  } catch (err) {
    port.postMessage({
      ok: false,
      error: err.message,
      code: err.code,
      detail: err.detail,
    });
  } finally {
    Atomics.store(int32, 0, 1);
    Atomics.notify(int32, 0, 1);
  }
});
