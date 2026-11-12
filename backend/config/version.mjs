import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getAppVersion() {
  try {
    const candidatePaths = [
      path.resolve(__dirname, '../../version.json'),
      path.resolve(__dirname, '../version.json'),
      path.resolve(process.cwd(), 'version.json'),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        if (data.version) {
          return data.version;
        }
      }
    }
  } catch (err) {
    // Ignore and fallback
  }
  return '0.0.7';
}

export const APP_VERSION = getAppVersion();
