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

let txClient = null;
let txDepth = 0;

async function releaseTxClient() {
  if (txClient) {
    const client = txClient;
    txClient = null;
    txDepth = 0;
    try {
      client.release();
    } catch {}
  }
}

async function handleTransactionCommand(upperSql) {
  if (upperSql === 'BEGIN' || upperSql === 'BEGIN TRANSACTION') {
    if (!txClient) {
      txClient = await pool.connect();
      txDepth = 1;
      await txClient.query('BEGIN');
    } else {
      txDepth += 1;
      await txClient.query(`SAVEPOINT sp_${txDepth}`);
    }
    return true;
  }
  if (upperSql === 'COMMIT' || upperSql === 'COMMIT TRANSACTION') {
    if (txClient) {
      if (txDepth > 1) {
        await txClient.query(`RELEASE SAVEPOINT sp_${txDepth}`);
        txDepth -= 1;
      } else {
        try {
          await txClient.query('COMMIT');
        } finally {
          await releaseTxClient();
        }
      }
    }
    return true;
  }
  if (upperSql === 'ROLLBACK' || upperSql === 'ROLLBACK TRANSACTION') {
    if (txClient) {
      if (txDepth > 1) {
        try {
          await txClient.query(`ROLLBACK TO SAVEPOINT sp_${txDepth}`);
        } finally {
          txDepth -= 1;
        }
      } else {
        try {
          await txClient.query('ROLLBACK');
        } finally {
          await releaseTxClient();
        }
      }
    }
    return true;
  }
  return false;
}

port.on('message', async (msg) => {
  try {
    const rawSql = String(msg.sql || '').trim().replace(/;$/, '').trim();
    const upperSql = rawSql.toUpperCase();

    if (msg.type === 'query') {
      if (await handleTransactionCommand(upperSql)) {
        port.postMessage({ ok: true, rows: [], rowCount: 0 });
      } else {
        const runner = txClient || pool;
        const res = await runner.query(msg.sql, msg.params || []);
        port.postMessage({
          ok: true,
          rows: res.rows || [],
          rowCount: res.rowCount || 0,
        });
      }
    } else if (msg.type === 'exec') {
      if (await handleTransactionCommand(upperSql)) {
        port.postMessage({ ok: true, rowCount: 0 });
      } else {
        const runner = txClient || pool;
        await runner.query(msg.sql);
        port.postMessage({ ok: true, rowCount: 0 });
      }
    } else if (msg.type === 'close') {
      await releaseTxClient();
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
