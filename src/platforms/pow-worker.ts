import { parentPort, workerData } from 'worker_threads';
import { solvePoWSync } from './pow-solver.js';

// Worker thread: PoW 연산을 별도 스레드에서 수행
const { seed, targetPrefix } = workerData as { seed: string; targetPrefix: string };
const nonce = solvePoWSync(seed, targetPrefix);
parentPort?.postMessage(nonce);
