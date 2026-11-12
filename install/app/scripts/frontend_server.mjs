#!/usr/bin/env node
/**
 * frontend_server.mjs - 독립형 프로덕션 프론트엔드 정적 파일 서버 & API 리버스 프록시
 * - 포트: FRONTEND_PORT (기본 9900)
 * - /api/* 요청: BACKEND_URL (http://127.0.0.1:8100)로 투명 리버스 프록시 (SSE 스트리밍 완벽 지원)
 * - 정적 파일 요청: frontend_dist/ 디렉터리 파일 서빙 (SPA 지원: 미일치 경로는 index.html 반환)
 * - 의존성: Node.js 내장 모듈(http, fs, path, url)만 사용 (무설치 경량 구동)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// app 디렉터리 내부 또는 프로젝트 루트에 위치할 때 모두 대응
const APP_DIR = path.resolve(__dirname, '..');
const DIST_DIR = fs.existsSync(path.join(__dirname, 'frontend_dist'))
  ? path.join(__dirname, 'frontend_dist')
  : fs.existsSync(path.join(APP_DIR, 'frontend_dist'))
  ? path.join(APP_DIR, 'frontend_dist')
  : fs.existsSync(path.join(APP_DIR, 'frontend', 'dist'))
  ? path.join(APP_DIR, 'frontend', 'dist')
  : path.join(__dirname, 'dist');

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '9900', 10);
const BACKEND_PORT = parseInt(process.env.PORT || '8100', 10);
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function proxyApiRequest(req, res) {
  const options = {
    hostname: BACKEND_HOST,
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${BACKEND_HOST}:${BACKEND_PORT}`,
      'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // SSE 또는 일반 응답 헤더 복사
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[Frontend Proxy Error] 백엔드(${BACKEND_HOST}:${BACKEND_PORT}) 연결 실패:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: 'Bad Gateway',
        message: '백엔드 서버(8100)와 통신할 수 없습니다. 백엔드가 구동 중인지 확인하세요.',
      }));
    }
  });

  req.pipe(proxyReq);
}

function serveStaticFile(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(urlObj.pathname);

  let filePath = path.join(DIST_DIR, pathname);

  // Directory Traversal 방지
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  // 디렉터리 접근 시 index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // 파일이 없으면 SPA 폴백(index.html)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found (dist directory not found)');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const headers = { 'Content-Type': contentType };
  if (ext === '.html') {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  } else {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api')) {
    return proxyApiRequest(req, res);
  }
  return serveStaticFile(req, res);
});

server.listen(FRONTEND_PORT, '0.0.0.0', () => {
  console.log('========================================================');
  console.log(`[Frontend] AutoStockTrader 프론트엔드 대시보드 서버 가동`);
  console.log(`• Listening  : http://0.0.0.0:${FRONTEND_PORT}`);
  console.log(`• Static Dir : ${DIST_DIR}`);
  console.log(`• API Proxy  : http://${BACKEND_HOST}:${BACKEND_PORT}`);
  console.log('========================================================');
});

function handleShutdown(signal) {
  console.log(`[Frontend] ${signal} 수신, 서버 종료`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
