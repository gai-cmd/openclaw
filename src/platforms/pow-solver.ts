import { createHash } from 'crypto';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ============================================================
// 머슴닷컴 Proof-of-Work 솔버
// ============================================================

const MAX_ITERATIONS = 10_000_000;

/** 동기 PoW 솔버 (worker_threads 내부에서 사용) */
export function solvePoWSync(seed: string, targetPrefix: string): string {
  for (let nonce = 0; nonce < MAX_ITERATIONS; nonce++) {
    const hash = createHash('sha256').update(`${seed}${nonce}`).digest('hex');
    if (hash.startsWith(targetPrefix)) {
      return String(nonce);
    }
  }
  throw new Error(`PoW solver exceeded ${MAX_ITERATIONS} iterations for prefix "${targetPrefix}"`);
}

/** 비동기 PoW 솔버 (메인 스레드에서 호출, worker_threads로 오프로드) */
export function solvePoW(seed: string, targetPrefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // worker_threads가 실패하면 메인 스레드에서 직접 해결
    try {
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const workerPath = join(currentDir, 'pow-worker.js');

      const worker = new Worker(workerPath, {
        workerData: { seed, targetPrefix },
      });

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('PoW solver timed out (30s)'));
      }, 30_000);

      worker.on('message', (nonce: string) => {
        clearTimeout(timeout);
        resolve(nonce);
        worker.terminate();
      });

      worker.on('error', (err) => {
        clearTimeout(timeout);
        // worker 실패 시 메인 스레드에서 폴백
        try {
          resolve(solvePoWSync(seed, targetPrefix));
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
      });
    } catch {
      // Worker 생성 실패 시 동기 폴백
      try {
        resolve(solvePoWSync(seed, targetPrefix));
      } catch (err) {
        reject(err);
      }
    }
  });
}
