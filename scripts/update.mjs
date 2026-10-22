// Worker de mise à jour. Le serveur le lance avec un canal IPC et un verrou possédé.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../server/env.mjs';
import { UpdateError, inspectInstallation, createCommandRunner, runChecked, readUpdateJob, writeUpdateJob, updatePaths, releaseUpdateLock } from '../server/updates.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function npmInvocation() {
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = candidates.find((p) => p && /\.(?:c?js|mjs)$/.test(p) && existsSync(p));
  if (cli) return { command: process.execPath, prefix: [cli] };
  if (process.platform !== 'win32') return { command: 'npm', prefix: [] };
  throw new UpdateError('npm_missing');
}

/**
 * Installe et construit dans un worktree isolé avant de toucher aux sources utilisées.
 * Le retour conserve les anciennes dépendances/interface jusqu'au redémarrage vérifié.
 * config.json, .env et data/ ne sont jamais déplacés ni supprimés.
 */
export async function applyUpdate({ root, targetHead, run = createCommandRunner(), npm = npmInvocation(), onProgress = () => {} }) {
  if (!/^[a-f0-9]{40,64}$/i.test(targetHead ?? '')) throw new UpdateError('invalid_target');
  const initial = await inspectInstallation(root, run);
  if (!initial.eligible) throw new UpdateError(initial.reason);
  const token = randomUUID();
  const data = updatePaths(root).data;
  const stage = join(data, `.update-stage-${token}`);
  const backup = join(data, `.update-backup-${token}`);
  const hooks = join(data, '.update-empty-hooks');
  mkdirSync(hooks, { recursive: true });
  const git = (args, failure, timeout = 30000) => runChecked(run, 'git', ['-c', `core.hooksPath=${hooks}`, ...args], { cwd: root, timeout }, failure);
  const swaps = [];
  let merged = false, hasWorktree = false, settled = false;

  const cleanStage = async () => {
    if (!hasWorktree) return;
    const result = await run('git', ['-c', `core.hooksPath=${hooks}`, 'worktree', 'remove', '--force', stage], { cwd: root, timeout: 30000 });
    // Un worktree refusé est conservé pour diagnostic ; aucun dossier arbitraire n'est effacé.
    if (result.code === 0) hasWorktree = false;
  };
  const rollback = async () => {
    if (settled) return;
    // --keep refuse d'écraser une modification apparue depuis : aucun reset dur, aucun stash.
    if (merged) await git(['reset', '--keep', initial.localHead], 'rollback_source_failed');
    for (const item of [...swaps].reverse()) {
      if (item.installed && existsSync(item.live)) rmSync(item.live, { recursive: true });
      if (item.saved && existsSync(item.saved)) renameSync(item.saved, item.live);
    }
    settled = true;
    await cleanStage();
    // Un reliquat de sauvegarde peut attendre ; les fichiers restaurés restent utilisables.
    try { if (existsSync(backup)) rmSync(backup, { recursive: true }); } catch {}
  };
  const finalize = async () => {
    if (settled) return;
    settled = true;
    await cleanStage();
    // La nouvelle version fonctionne déjà : un nettoyage refusé ne doit pas l'arrêter.
    try { if (existsSync(backup)) rmSync(backup, { recursive: true }); } catch {}
  };

  try {
    onProgress('checking');
    await git(['fetch', '--no-tags', 'origin', 'refs/heads/main'], 'fetch_failed', 120000);
    const fetched = await git(['rev-parse', 'FETCH_HEAD'], 'fetch_failed');
    if (fetched !== targetHead) throw new UpdateError('remote_changed');
    await git(['merge-base', '--is-ancestor', initial.localHead, targetHead], 'not_fast_forward');
    const protectedPaths = await git(['ls-tree', '-r', '--name-only', targetHead, '--', '.env', 'config.json', 'data', 'node_modules', 'web/dist'], 'git_error');
    if (protectedPaths) throw new UpdateError('protected_paths');
    if (targetHead === initial.localHead) throw new UpdateError('no_update');
    onProgress('preparing');
    await git(['worktree', 'add', '--detach', stage, targetHead], 'stage_failed', 60000);
    hasWorktree = true;
    onProgress('installing');
    await runChecked(run, npm.command, [...npm.prefix, 'ci', '--ignore-scripts'], { cwd: stage, timeout: 8 * 60 * 1000 }, 'install_failed');
    onProgress('building');
    await runChecked(run, npm.command, [...npm.prefix, 'run', 'build'], { cwd: stage, timeout: 5 * 60 * 1000 }, 'build_failed');
    if (!existsSync(join(stage, 'web', 'dist', 'index.html')) || !existsSync(join(stage, 'node_modules'))) throw new UpdateError('build_output_missing');
    const beforeApply = await inspectInstallation(root, run);
    if (!beforeApply.eligible) throw new UpdateError(beforeApply.reason);
    if (beforeApply.localHead !== initial.localHead) throw new UpdateError('local_changed');
    onProgress('applying');
    await git(['merge', '--ff-only', targetHead], 'merge_failed', 60000);
    merged = true;
    mkdirSync(backup, { recursive: true });
    for (const rel of ['node_modules', 'web/dist']) {
      const live = join(root, rel), prepared = join(stage, rel), saved = join(backup, rel.replace('/', '-'));
      const item = { live, saved: null, installed: false };
      swaps.push(item);
      if (existsSync(live)) { renameSync(live, saved); item.saved = saved; }
      mkdirSync(dirname(live), { recursive: true });
      renameSync(prepared, live);
      item.installed = true;
    }
    await cleanStage();
    return { previousHead: initial.localHead, targetHead, rollback, finalize };
  } catch (error) {
    try { await rollback(); } catch (restoreError) {
      throw new UpdateError(restoreError.code ?? 'rollback_failed');
    }
    throw error;
  }
}

async function requestRestart(jobId) {
  if (!process.connected || !process.send) throw new UpdateError('parent_missing');
  await new Promise((done, fail) => {
    let acknowledged = false;
    const timer = setTimeout(() => { cleanup(); fail(new UpdateError('restart_timeout')); }, 20000);
    const onMessage = (m) => { if (m?.type === 'restart-ack' && m.jobId === jobId) acknowledged = true; };
    const onDisconnect = () => { cleanup(); acknowledged ? done() : fail(new UpdateError('restart_not_acknowledged')); };
    const cleanup = () => { clearTimeout(timer); process.off('message', onMessage); process.off('disconnect', onDisconnect); };
    process.on('message', onMessage);
    process.on('disconnect', onDisconnect);
    process.send({ type: 'restart-ready', jobId });
  });
}

function launchServer(root, port) {
  const log = openSync(join(root, 'data', 'update-server.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [join(root, 'server', 'index.mjs')], {
      cwd: root, env: { ...process.env, PORT: String(port) }, detached: true,
      stdio: ['ignore', log, log], windowsHide: true,
    });
    // Erreurs observées pendant la vérification ; après unref, le serveur survit au worker.
    child.on('error', () => {});
    child.unref();
    return child;
  } finally { closeSync(log); }
}

async function verifyServer(child, port, targetHead, jobId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new UpdateError('restart_failed');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/update`, { signal: AbortSignal.timeout(1000) });
      const state = await response.json();
      if (response.ok && state.localHead === targetHead && state.job?.id === jobId) return;
    } catch {}
    await sleep(500);
  }
  throw new UpdateError('restart_failed');
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((done) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 4000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill('SIGTERM');
  });
}

export async function runWorker({ root = ROOT, port, jobId } = {}) {
  let job = readUpdateJob(root);
  const lock = updatePaths(root).lock;
  if (!job || job.id !== jobId || readFileSync(join(lock, 'owner'), 'utf8') !== jobId) throw new UpdateError('invalid_job');
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new UpdateError('invalid_port');
  const progress = (phase) => { job = writeUpdateJob(root, { ...job, phase, workerPid: process.pid }); };
  let transaction, restarted;
  try {
    transaction = await applyUpdate({ root, targetHead: job.targetHead, onProgress: progress });
    progress('restarting');
    await requestRestart(jobId);
    restarted = launchServer(root, port);
    await verifyServer(restarted, port, job.targetHead, jobId);
    await transaction.finalize();
    job = writeUpdateJob(root, { ...job, phase: 'complete', completedAt: new Date().toISOString(), error: null });
  } catch (error) {
    await stopOwnedChild(restarted);
    let reason = error.code ?? 'update_failed';
    if (transaction) {
      try { await transaction.rollback(); } catch (restoreError) { reason = restoreError.code ?? 'rollback_failed'; }
    }
    job = writeUpdateJob(root, { ...job, phase: 'error', error: reason });
    // Si le serveur demandeur a déjà quitté, on relance la version restaurée, sans navigateur.
    if (!process.connected && transaction && !reason.startsWith('rollback')) launchServer(root, port);
    process.exitCode = 1;
  } finally {
    releaseUpdateLock(root, jobId);
    if (process.connected) process.disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  if (!process.argv.includes('--worker')) {
    console.error('Lance la mise à jour depuis le bouton de l’application.');
    process.exitCode = 1;
  } else {
    await runWorker({ port: Number(arg('--port')), jobId: arg('--job') }).catch((error) => {
      // Codes stables uniquement : aucun secret provenant des commandes n'est imprimé.
      console.error(error instanceof UpdateError ? error.code : 'update_failed');
      process.exitCode = 1;
    });
  }
}
