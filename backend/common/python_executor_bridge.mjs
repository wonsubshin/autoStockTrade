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

      const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

      // 3.3 명시적 15초 타임아웃 및 서브프로세스 좀비화 방지
      const child = execFile(pythonBin, args, {
        timeout: 15000,
        killSignal: 'SIGTERM',
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          let errMsg = stderr ? stderr.trim() : error.message;
          if (error.killed || error.signal === 'SIGTERM') {
            errMsg = `Python 프로세스 실행 타임아웃(15000ms 초과)으로 안전하게 강제 종료되었습니다.`;
          }
          if (stdout) {
            try {
              const parsed = JSON.parse(stdout.trim());
              if (parsed.error) errMsg = parsed.error;
            } catch (e) {}
          }
          return reject(new Error(`[PythonExecutor] ${errMsg}`));
        }

        const raw = (stdout || '').trim();
        if (!raw) {
          return reject(new Error(`[PythonExecutor] 빈 응답 반환 (stderr: ${stderr || '없음'})`));
        }

        try {
          const result = JSON.parse(raw);
          if (result && result.error) {
            return reject(new Error(`[PythonExecutor] 브로커 주문 에러: ${result.error}`));
          }
          resolve(result);
        } catch (e) {
          reject(new Error(`[PythonExecutor] JSON 파싱 실패: "${raw.slice(0, 200)}" (stderr: ${stderr || '없음'})`));
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

