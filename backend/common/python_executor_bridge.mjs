import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '../..');

/**
 * Node.js ⨉ Python 하이브리드 연동 브릿지 (PythonExecutorBridge)
 * - LLM 분석 및 봇 스케줄러(Node.js)의 매매 결정을 받아
 * - 실제 토스증권 API 주문 및 정밀 체결(Python Core Executor)을 수행
 */
export class PythonExecutorBridge {
  constructor(projectRoot = DEFAULT_ROOT) {
    this.projectRoot = projectRoot || DEFAULT_ROOT;
    this.scriptPath = path.join(this.projectRoot, 'backend', 'python', 'toss_executor.py');
  }

  runCommand(action, params = {}) {
    return new Promise((resolve, reject) => {
      const args = [
        this.scriptPath,
        '--action', action,
        '--params', JSON.stringify(params),
        '--root', this.projectRoot,
      ];

      execFile('python3', args, { timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
          let errMsg = stderr || error.message;
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) errMsg = parsed.error;
          } catch (e) {}
          return reject(new Error(`[PythonExecutor] ${errMsg}`));
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (e) {
          reject(new Error(`[PythonExecutor] JSON 파싱 실패: ${stdout} (stderr: ${stderr})`));
        }
      });
    });
  }

  // 실전 주문 발송 (국내 및 해외 소수점 거래)
  async executeOrder(orderParams) {
    return this.runCommand('order', orderParams);
  }

  // Python 기반 실시간 잔고 조회
  async getBalance() {
    return this.runCommand('balance');
  }

  // Python 기반 헬스체크
  async getHealth() {
    return this.runCommand('health');
  }

  // 실시간 환율 조회
  async getExchangeRate() {
    const res = await this.runCommand('rate');
    return res.exchangeRate || 1340;
  }
}

