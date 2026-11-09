import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

