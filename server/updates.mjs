// Mises à jour locales : GitHub est consulté en lecture seule jusqu'au clic de la personne.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './env.mjs';

export const UPDATE_REPOSITORY = 'https://github.com/renaud-bxl/prosper-et-les-prospects';
export const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
export const ACTIVE_UPDATE_PHASES = new Set(['queued', 'checking', 'preparing', 'installing', 'building', 'applying', 'restarting']);
const ORIGIN = /^(?:https:\/\/github\.com\/renaud-bxl\/prosper-et-les-prospects(?:\.git)?\/?|git@github\.com:renaud-bxl\/prosper-et-les-prospects(?:\.git)?|ssh:\/\/git@github\.com\/renaud-bxl\/prosper-et-les-prospects(?:\.git)?)$/i;
const SHA = /^[a-f0-9]{40,64}$/i;

export class UpdateError extends Error {
  constructor(code) { super(code); this.name = 'UpdateError'; this.code = code; }
}

/** Aucun shell, aucun contenu de stderr dans les états ou journaux (ils peuvent contenir des secrets). */
export function createCommandRunner() {
  return (command, args, { cwd, timeout = 30000 } = {}) => new Promise((resolveResult) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (error, stdout, stderr) => {
      resolveResult({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export async function runChecked(run, command, args, options, failure) {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new UpdateError(failure);
  return String(result.stdout ?? '').trim();
}

export function updatePaths(root) {
  return { data: join(root, 'data'), state: join(root, 'data', '.update-state.json'), lock: join(root, 'data', '.update-lock') };
}

export function readUpdateJob(root) {
  try { return JSON.parse(readFileSync(updatePaths(root).state, 'utf8')); } catch { return null; }
}

export function writeUpdateJob(root, job) {
  const paths = updatePaths(root);
  mkdirSync(paths.data, { recursive: true });
  const next = { ...job, updatedAt: new Date().toISOString() };
  const temporary = `${paths.state}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, paths.state);
  return next;
}

export async function inspectInstallation(root, run = createCommandRunner()) {
  const git = (args) => run('git', args, { cwd: root });
  const top = await git(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { eligible: false, reason: 'not_git' };
  try {
    if (realpathSync(String(top.stdout).trim()) !== realpathSync(root)) return { eligible: false, reason: 'not_git' };
  } catch { return { eligible: false, reason: 'not_git' }; }
  const origin = await git(['remote', 'get-url', 'origin']);
  if (origin.code !== 0 || !ORIGIN.test(String(origin.stdout).trim())) return { eligible: false, reason: 'wrong_origin' };
  const head = await git(['rev-parse', 'HEAD']);
  const branch = await git(['branch', '--show-current']);
  const dirty = await git(['status', '--porcelain', '--untracked-files=no']);
  const localHead = String(head.stdout).trim();
  if (head.code !== 0 || !SHA.test(localHead) || branch.code !== 0 || dirty.code !== 0) return { eligible: false, reason: 'git_error' };
  const result = { localHead, branch: String(branch.stdout).trim(), dirty: Boolean(String(dirty.stdout).trim()) };
  if (result.branch !== 'main') return { ...result, eligible: false, reason: 'wrong_branch' };
  if (result.dirty) return { ...result, eligible: false, reason: 'dirty' };
  const date = await git(['show', '-s', '--format=%cI', 'HEAD']);
  return { ...result, eligible: true, reason: null, localDate: date.code === 0 ? String(date.stdout).trim() : null };
}

export function createUpdateService({ root = ROOT, run = createCommandRunner(), spawnWorker = spawn,
  exit = (code) => process.exit(code), now = () => Date.now(), checkInterval = UPDATE_INTERVAL_MS } = {}) {
  root = resolve(root);
  let cache = null;
  let pendingCheck = null;
  let starting = false;

  const isUpdating = () => {
    const job = readUpdateJob(root);
    return Boolean(starting || job && ACTIVE_UPDATE_PHASES.has(job.phase) && now() - Date.parse(job.updatedAt) < 30 * 60 * 1000);
  };

  async function checkRemote() {
    const result = await run('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: root, timeout: 20000 });
    const match = String(result.stdout ?? '').trim().match(/^([a-f0-9]{40,64})\s+refs\/heads\/main$/i);
    return result.code === 0 && match
      ? { remoteHead: match[1], checkedAt: new Date(now()).toISOString(), networkError: false }
      : { remoteHead: null, checkedAt: new Date(now()).toISOString(), networkError: true };
  }

  async function getUpdateStatus({ force = false } = {}) {
    const local = await inspectInstallation(root, run);
    let job = readUpdateJob(root);
    if (job && ACTIVE_UPDATE_PHASES.has(job.phase) && now() - Date.parse(job.updatedAt) >= 30 * 60 * 1000) {
      job = writeUpdateJob(root, { ...job, phase: 'error', error: 'worker_stopped' });
      releaseUpdateLock(root, job.id);
    }
    if (!local.eligible) return { ...local, repository: UPDATE_REPOSITORY, available: false, canUpdate: false, checkedAt: cache?.checkedAt ?? null, job };
    if (job && ACTIVE_UPDATE_PHASES.has(job.phase) && now() - Date.parse(job.updatedAt) < 30 * 60 * 1000) return { ...local, repository: UPDATE_REPOSITORY,
      remoteHead: job.targetHead, available: false, canUpdate: false, checkedAt: cache?.checkedAt ?? job.startedAt, job };
    if (force || !cache || now() - Date.parse(cache.checkedAt) >= checkInterval) {
      pendingCheck ??= checkRemote().finally(() => { pendingCheck = null; });
      cache = await pendingCheck;
    }
    let relation = cache.networkError ? 'unknown' : cache.remoteHead === local.localHead ? 'current' : 'different';
    let remoteDate = null;
    if (relation === 'different') {
      const object = await run('git', ['cat-file', '-e', `${cache.remoteHead}^{commit}`], { cwd: root });
      if (object.code === 0) {
        const remoteOlder = await run('git', ['merge-base', '--is-ancestor', cache.remoteHead, local.localHead], { cwd: root });
        if (remoteOlder.code === 0) relation = 'ahead';
        else {
          const forward = await run('git', ['merge-base', '--is-ancestor', local.localHead, cache.remoteHead], { cwd: root });
          if (forward.code !== 0) relation = 'diverged';
        }
      }
    }
    if (cache.remoteHead) {
      const date = await run('git', ['show', '-s', '--format=%cI', cache.remoteHead], { cwd: root });
      if (date.code === 0) remoteDate = String(date.stdout).trim();
    }
    const available = relation === 'different';
    return { ...local, ...cache, remoteDate, relation, repository: UPDATE_REPOSITORY, available,
      canUpdate: available && !isUpdating(), reason: cache.networkError ? 'network' : relation === 'diverged' ? 'diverged' : null, job };
  }

  async function startUpdate({ port = 5577 } = {}) {
    if (starting || isUpdating()) throw new UpdateError('busy');
    starting = true;
    let job;
    try {
      const status = await getUpdateStatus({ force: true });
      if (!status.eligible) throw new UpdateError(status.reason);
      // starting bloque les autres demandes ; canUpdate inclut cette protection.
      if (!status.available) throw new UpdateError(status.reason ?? 'no_update');
      if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new UpdateError('invalid_port');
      const paths = updatePaths(root);
      mkdirSync(paths.data, { recursive: true });
      const previousJob = readUpdateJob(root);
      if (previousJob && (!ACTIVE_UPDATE_PHASES.has(previousJob.phase) || now() - Date.parse(previousJob.updatedAt) >= 30 * 60 * 1000)) releaseUpdateLock(root, previousJob.id);
      try { mkdirSync(paths.lock); } catch { throw new UpdateError('busy'); }
      job = { id: randomUUID(), phase: 'queued', targetHead: status.remoteHead, previousHead: status.localHead, startedAt: new Date(now()).toISOString() };
      writeFileSync(join(paths.lock, 'owner'), job.id, { mode: 0o600 });
      writeUpdateJob(root, job);
      const worker = spawnWorker(process.execPath, [join(root, 'scripts', 'update.mjs'), '--worker', '--port', String(port), '--job', job.id], {
        cwd: root, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
      worker.once('error', () => { writeUpdateJob(root, { ...job, phase: 'error', error: 'worker_failed' }); releaseUpdateLock(root, job.id); });
      worker.on('message', (message) => {
        if (message?.type !== 'restart-ready' || message.jobId !== job.id) return;
        // Ce processus est le serveur demandeur lui-même : aucun PID extérieur n'est arrêté.
        worker.send?.({ type: 'restart-ack', jobId: job.id });
        setTimeout(() => exit(0), 500).unref();
      });
      worker.once('exit', (code) => {
        const latest = readUpdateJob(root);
        if (latest?.id === job.id && ACTIVE_UPDATE_PHASES.has(latest.phase)) {
          writeUpdateJob(root, { ...latest, phase: 'error', error: code === 0 ? 'worker_stopped' : 'worker_failed' });
          releaseUpdateLock(root, job.id);
        }
      });
      worker.unref?.();
      worker.channel?.unref?.();
      return readUpdateJob(root);
    } catch (error) {
      if (job) { writeUpdateJob(root, { ...job, phase: 'error', error: error.code ?? 'update_failed' }); releaseUpdateLock(root, job.id); }
      throw error;
    } finally { starting = false; }
  }
  return { getUpdateStatus, startUpdate, isUpdating };
}

export function releaseUpdateLock(root, id) {
  const lock = updatePaths(root).lock;
  try { if (readFileSync(join(lock, 'owner'), 'utf8') === id) rmSync(lock, { recursive: true }); } catch {}
}

const service = createUpdateService();
export const getUpdateStatus = service.getUpdateStatus;
export const startUpdate = service.startUpdate;
export const isUpdating = service.isUpdating;
