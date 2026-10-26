import { parentPort, workerData } from 'node:worker_threads';
import { lireDirecte, echecLecture } from './lecteur.mjs';

try {
  const result = await lireDirecte(workerData.place, { onStep: (texte) => parentPort.postMessage({ type: 'step', texte }) });
  parentPort.postMessage({ type: 'result', result });
} catch {
  parentPort.postMessage({ type: 'result', result: echecLecture('site_read_failed') });
}
