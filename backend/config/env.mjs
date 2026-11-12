import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

export function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (k && !process.env[k]) {
          process.env[k] = v;
        }
      }
    }
  }
}
loadEnv();

export const PORT = parseInt(process.env.PORT || '8100', 10);
export const BROKER_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'broker_config.json');
export const GATE_PASSCODE = process.env.GATE_PASSCODE || 'sws@2129';
export const USE_POSTGRES = String(process.env.USE_POSTGRES || '').toLowerCase() === 'true';

// 4.1 기본 게이트 패스코드 사용 시 보안 경고 출력
if (GATE_PASSCODE === 'sws@2129' || GATE_PASSCODE === 'coin') {
  console.warn('\x1b[33m%s\x1b[0m', '⚠️ [보안 경고] 기본 게이트 패스코드(sws@2129)가 사용 중입니다.');
  console.warn('\x1b[33m%s\x1b[0m', '   외부 포트포워딩(9900, 8100) 또는 원격 환경에서는 .env의 GATE_PASSCODE 또는 [환경설정] 메뉴에서 안전한 비밀번호로 변경하세요.');
}

// Ensure base directories exist
fs.mkdirSync(path.join(PROJECT_ROOT, 'data'), { recursive: true });
fs.mkdirSync(path.join(PROJECT_ROOT, 'logs'), { recursive: true });
fs.mkdirSync(path.join(PROJECT_ROOT, 'config'), { recursive: true });

