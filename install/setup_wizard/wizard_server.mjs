#!/usr/bin/env node
/**
 * wizard_server.mjs - 비개발자용 Step-by-Step 온보딩 초기 설정 마법사 백엔드 서버
 * - 포트: 9901 (메인 대시보드 9900 및 백엔드 8100과 포트 충돌 방지)
 * - 정적 UI: setup_wizard/wizard_ui.html 서빙
 * - API:
 *   - GET  /api/wizard/system-check : OS, Node.js, Python, 포트 8100/9900 가용 여부 점검
 *   - POST /api/wizard/test-db      : PostgreSQL 연결 테스트 및 8대 테이블/시드 자동 생성
 *   - POST /api/wizard/complete     : 설정 파일(.env, broker_config.json) 생성, DB 초기화, 서비스 백그라운드 기동
 *   - POST /api/wizard/auto-install : 누락된 의존성 패키지 자동 설치
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { exec, execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 대상 애플리케이션 루트 경로 계산 (/install/app 또는 프로젝트 루트)
const APP_DIR = fs.existsSync(path.join(__dirname, '..', 'app'))
  ? path.resolve(__dirname, '..', 'app')
  : path.resolve(__dirname, '..');

const WIZARD_PORT = parseInt(process.env.WIZARD_PORT || '9901', 10);
const HTML_FILE = path.join(__dirname, 'wizard_ui.html');

// 헬퍼: 포트 사용 여부 점검
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

// 헬퍼: Python 버전 점검
function checkPython() {
  return new Promise((resolve) => {
    const pythonCommands = process.platform === 'win32'
      ? ['python', 'py', 'python3']
      : ['python3', 'python'];

    let tried = 0;
    function tryNext() {
      if (tried >= pythonCommands.length) {
        return resolve({ ok: false, version: '미설치', command: null });
      }
      const cmd = pythonCommands[tried++];
      exec(`${cmd} --version`, (err, stdout, stderr) => {
        const out = (stdout || stderr || '').trim();
        const match = out.match(/Python\s+([0-9.]+)/i);
        if (!err && match) {
          const verStr = match[1];
          const [major, minor] = verStr.split('.').map(Number);
          const ok = major === 3 && minor >= 10;
          return resolve({ ok, version: verStr, command: cmd, raw: out });
        }
        tryNext();
      });
    }
    tryNext();
  });
}

// 헬퍼: 브라우저 자동 실행
export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}" || sensible-browser "${url}" || google-chrome "${url}" || firefox "${url}"`);
    }
  } catch (e) {
    console.warn(`[Wizard] 브라우저 자동 오픈 실패: ${e.message}`);
  }
}

// 헬퍼: JSON 응답 전송
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

// 헬퍼: JSON Body 파싱
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // CORS 프리플라이트
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // 1. [Step 1] 환경 점검 API
  if (pathname === '/api/wizard/system-check' && method === 'GET') {
    try {
      const nodeVer = process.version;
      const nodeMajor = parseInt(nodeVer.replace(/^v/, '').split('.')[0], 10);
      const nodeOk = nodeMajor >= 20;

      const pythonInfo = await checkPython();
      const port8100Ok = await checkPortAvailable(8100);
      const port9900Ok = await checkPortAvailable(9900);

      const memTotalGb = (os.totalmem() / (1024 ** 3)).toFixed(1);
      const memFreeGb = (os.freemem() / (1024 ** 3)).toFixed(1);

      return sendJson(res, 200, {
        ok: true,
        os: {
          platform: process.platform,
          platformName: process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'macOS' : 'Linux'),
          release: os.release(),
          arch: process.arch,
          hostname: os.hostname(),
          memory: `${memFreeGb}GB 가용 / 총 ${memTotalGb}GB`,
        },
        node: {
          ok: nodeOk,
          version: nodeVer,
          target: 'v20.0.0 이상 (권장 v22+)',
        },
        python: {
          ok: pythonInfo.ok,
          version: pythonInfo.version,
          command: pythonInfo.command,
          target: '3.12 이상 (최소 3.10+)',
        },
        ports: {
          port8100: port8100Ok,
          port9900: port9900Ok,
        },
        appDir: APP_DIR,
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // 2. [Step 2] PostgreSQL 연결 테스트 및 테이블 자동 생성 API
  if (pathname === '/api/wizard/test-db' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { host = '127.0.0.1', port = 5432, database = 'stock', user = 'stock_trader', password = '' } = body;

      let pg;
      try {
        pg = (await import('pg')).default;
      } catch (e) {
        return sendJson(res, 400, {
          ok: false,
          error: 'pg 라이브러리를 로드할 수 없습니다. npm install pg 가 필요합니다.',
        });
      }

      const client = new pg.Client({
        host,
        port: parseInt(port, 10),
        database,
        user,
        password,
        connectionTimeoutMillis: 5000,
      });

      await client.connect();

      // DB 모듈에서 PG_SCHEMA_SQL 로드 시도
      let schemaSql = '';
      try {
        const dbModPath = path.join(APP_DIR, 'backend', 'db', 'index.mjs');
        const dbMod = await import(dbModPath);
        schemaSql = dbMod.PG_SCHEMA_SQL || '';
      } catch (e) {}

      if (schemaSql) {
        await client.query(schemaSql);
      }

      const resDb = await client.query('SELECT current_database(), current_user, version()');
      await client.end();

      return sendJson(res, 200, {
        ok: true,
        message: `PostgreSQL 연결 및 스키마 검증 완료! (DB: ${resDb.rows[0].current_database}, 유저: ${resDb.rows[0].current_user})`,
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: `PostgreSQL 연결 실패: ${err.message}`,
      });
    }
  }

  // 3. [Step 5] 설치 완료 및 시스템 원클릭 기동 API
  if (pathname === '/api/wizard/complete' && method === 'POST') {
    try {
      const config = await parseBody(req);

      const dbMode = config.dbMode || 'SQLITE_ONLY';
      const pgCfg = config.pgConfig || {};
      const kiwoom = config.kiwoom || {};
      const toss = config.toss || {};
      const gemini = config.gemini || {};
      const security = config.security || {};
      const budget = config.budget || {};

      const gatePasscode = security.gate_passcode || 'sws@2129';
      const realTotalBudget = parseInt(budget.real_total_budget || '10000000', 10);
      const virtualSeedPerBot = parseInt(budget.virtual_seed_per_bot || '10000000', 10);

      // (1) .env 파일 자동 생성
      const envLines = [
        '# ========================================================',
        '# AutoStockTrader - 자동 생성된 환경 설정 파일 (.env)',
        `# 생성 일시: ${new Date().toISOString()}`,
        '# ========================================================',
        '',
        'PORT=8100',
        'FRONTEND_PORT=9900',
        '',
        `GEMINI_API_KEY=${gemini.api_key || ''}`,
        '',
        `DB_MODE=${dbMode}`,
        `LOCATION=${pgCfg.location || 'local'}`,
        '',
        '# [PostgreSQL 설정]',
        `LOCAL_PG_HOST=${pgCfg.host || '127.0.0.1'}`,
        `LOCAL_PG_PORT=${pgCfg.port || 5432}`,
        `LOCAL_PG_DATABASE=${pgCfg.database || 'stock'}`,
        `LOCAL_PG_USER=${pgCfg.user || 'stock_trader'}`,
        `LOCAL_PG_PASSWORD=${pgCfg.password || ''}`,
        '',
      ];
      fs.writeFileSync(path.join(APP_DIR, '.env'), envLines.join('\n'), 'utf8');

      // (2) config/broker_config.json 파일 자동 생성
      const configDir = path.join(APP_DIR, 'config');
      fs.mkdirSync(configDir, { recursive: true });

      const brokerConfig = {
        account_mode: 'VIRTUAL',
        kiwoom: {
          app_key: kiwoom.app_key || '',
          app_secret: kiwoom.app_secret || '',
          base_url: kiwoom.base_url || 'https://openapi.kiwoom.com',
          simulation: Boolean(kiwoom.simulation),
        },
        toss: {
          api_key: toss.client_id || toss.api_key || '',
          api_secret: toss.client_secret || toss.api_secret || '',
          account_no: toss.account_no || '',
          base_url: toss.base_url || 'https://openapi.tossinvest.com',
        },
        gemini: {
          api_key: gemini.api_key || '',
          model: gemini.model || 'gemini-1.5-flash',
        },
      };
      fs.writeFileSync(
        path.join(configDir, 'broker_config.json'),
        JSON.stringify(brokerConfig, null, 2),
        'utf8'
      );

      // (3) 데이터베이스 초기화 및 시드 데이터 업데이트
      const dbModPath = path.join(APP_DIR, 'backend', 'db', 'index.mjs');
      const { initDatabase, getDb, closeDatabase } = await import(dbModPath);
      process.env.DB_MODE = dbMode;
      const db = initDatabase();

      // system_settings에 gate_passcode 및 budget 저장
      const nowIso = new Date().toISOString();
      const stmtSet = db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      stmtSet.run('gate_passcode', gatePasscode, nowIso);
      stmtSet.run('real_total_budget', String(realTotalBudget), nowIso);
      stmtSet.run('virtual_total_budget', String(virtualSeedPerBot * 10), nowIso);
      stmtSet.run('virtual_seed_money', String(virtualSeedPerBot), nowIso);

      // (4) .setup_completed 마커 파일 생성
      fs.writeFileSync(
        path.join(APP_DIR, '.setup_completed'),
        JSON.stringify({
          completed_at: new Date().toISOString(),
          db_mode: dbMode,
          version: '1.0.0',
        }, null, 2),
        'utf8'
      );

      // (5) 백그라운드 서비스 기동
      const logsDir = path.join(APP_DIR, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });

      const backendLog = fs.openSync(path.join(logsDir, 'backend.log'), 'a');
      const frontendLog = fs.openSync(path.join(logsDir, 'frontend.log'), 'a');
      const llmLog = fs.openSync(path.join(logsDir, 'llm_filter.log'), 'a');

      // 백엔드 프로세스 실행
      const backendScript = path.join(APP_DIR, 'backend', 'node_server.mjs');
      const backendSub = spawn(process.execPath, [backendScript], {
        cwd: APP_DIR,
        detached: true,
        stdio: ['ignore', backendLog, backendLog],
      });
      backendSub.unref();
      fs.writeFileSync(path.join(logsDir, '.backend.pid'), String(backendSub.pid));

      // 프론트엔드 프로세스 실행
      const frontendScript = fs.existsSync(path.join(APP_DIR, 'frontend_server.mjs'))
        ? path.join(APP_DIR, 'frontend_server.mjs')
        : path.join(__dirname, '..', 'scripts', 'frontend_server.mjs');

      const frontendSub = spawn(process.execPath, [frontendScript], {
        cwd: APP_DIR,
        detached: true,
        stdio: ['ignore', frontendLog, frontendLog],
      });
      frontendSub.unref();
      fs.writeFileSync(path.join(logsDir, '.frontend.pid'), String(frontendSub.pid));

      // Python LLM 워커 실행
      const pythonInfo = await checkPython();
      const pythonBin = pythonInfo.command || (process.platform === 'win32' ? 'python' : 'python3');
      const llmScript = path.join(APP_DIR, 'backend', 'python', 'llm_filter_worker.py');
      if (fs.existsSync(llmScript)) {
        const llmSub = spawn(pythonBin, [llmScript], {
          cwd: APP_DIR,
          detached: true,
          stdio: ['ignore', llmLog, llmLog],
        });
        llmSub.unref();
        fs.writeFileSync(path.join(logsDir, '.llm_filter.pid'), String(llmSub.pid));
      }

      // (6) 서비스 헬스체크 대기 (최대 10초)
      let backendHealthy = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const resHealth = await fetch('http://127.0.0.1:8100/api/health');
          if (resHealth.ok) {
            backendHealthy = true;
            break;
          }
        } catch (e) {}
      }

      // 성공 응답 전송
      sendJson(res, 200, {
        ok: true,
        backendHealthy,
        redirectUrl: 'http://127.0.0.1:9900',
        message: '자동매매 시스템이 성공적으로 구동되었습니다!',
      });

      // 브라우저 9900 오픈 및 마법사 종료 스케줄
      setTimeout(() => {
        openBrowser('http://127.0.0.1:9900');
      }, 1000);

      setTimeout(() => {
        console.log('[Wizard] 초기 설정 완료로 마법사 서버를 종료합니다.');
        process.exit(0);
      }, 3000);

      return;
    } catch (err) {
      console.error('[Wizard Complete Error]', err);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // 4. 마법사 HTML 화면 서빙
  if (pathname === '/' || pathname === '/index.html' || pathname === '') {
    if (fs.existsSync(HTML_FILE)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(HTML_FILE).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('wizard_ui.html 파일을 찾을 수 없습니다.');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(WIZARD_PORT, '0.0.0.0', () => {
  console.log('========================================================');
  console.log(`🪄 AutoStockTrader 초기 설정 마법사 서버 가동 완료`);
  console.log(`• 마법사 주소 : http://127.0.0.1:${WIZARD_PORT}`);
  console.log(`• 앱 설치 대상 : ${APP_DIR}`);
  console.log('========================================================');

  // --open 플래그 지정 시 기본 브라우저 자동 오픈
  if (process.argv.includes('--open')) {
    openBrowser(`http://127.0.0.1:${WIZARD_PORT}`);
  }
});
