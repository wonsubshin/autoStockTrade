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
export const DB_PATH = path.join(PROJECT_ROOT, 'data', 'auto_stock_trade.db');
export const BROKER_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'broker_config.json');

// Ensure base directories exist
fs.mkdirSync(path.join(PROJECT_ROOT, 'data'), { recursive: true });
fs.mkdirSync(path.join(PROJECT_ROOT, 'logs'), { recursive: true });
fs.mkdirSync(path.join(PROJECT_ROOT, 'config'), { recursive: true });

