import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVersion() {
  try {
    const vPath = path.resolve(__dirname, '../version.json');
    if (fs.existsSync(vPath)) {
      return JSON.parse(fs.readFileSync(vPath, 'utf-8')).version;
    }
  } catch {}
  try {
    const pkgPath = path.resolve(__dirname, 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {}
  return '0.0.7';
}

const APP_VERSION = getVersion();

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname, '..');
  const env = { ...process.env, ...loadEnv(mode, rootDir, '') };

  const frontendPort = parseInt(env.FRONTEND_PORT || '9900', 10);
  const backendPort = parseInt(env.PORT || '8100', 10);
  const backendHost = env.BACKEND_HOST || '127.0.0.1';
  const backendUrl = env.BACKEND_URL || `http://${backendHost}:${backendPort}`;
  const host = env.HOST || '0.0.0.0';

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    server: {
      host,
      port: frontendPort,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host,
      port: frontendPort,
      allowedHosts: true,
    },
  };
});

