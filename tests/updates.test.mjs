import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createCommandRunner, inspectInstallation, createUpdateService, UPDATE_REPOSITORY, writeUpdateJob, readUpdateJob, updatePaths } from '../server/updates.mjs';
import { applyUpdate } from '../scripts/update.mjs';

const git = (root, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (root, path, value) => { const parent = path.split('/').slice(0, -1).join('/'); if (parent) mkdirSync(join(root, parent), { recursive: true }); writeFileSync(join(root, path), value); };
const commit = (root) => git(root, '-c', 'user.name=Update tests', '-c', 'user.email=tests@example.invalid', 'commit', '-m', 'fixture');

function fixture(t, { protectedRemote = false, divergent = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'prosper-update-test-'));
  const root = join(base, 'app'), remote = join(base, 'remote.git');
  mkdirSync(root);
  git(root, 'init', '--initial-branch=main');
  put(root, '.gitignore', 'data/\nnode_modules/\nweb/dist/\nconfig.json\n.env\n');
  put(root, 'version.txt', 'old');
  put(root, 'package.json', '{"name":"fixture","version":"1.0.0"}\n');
  put(root, 'package-lock.json', '{"lockfileVersion":3}\n');
  git(root, 'add', '.'); commit(root);
  const previousHead = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-b', 'incoming');
  put(root, 'version.txt', 'new');
  if (protectedRemote) { put(root, 'config.json', 'remote data'); git(root, 'add', '-f', 'config.json'); }
  git(root, 'add', 'version.txt'); commit(root);
  let targetHead = git(root, 'rev-parse', 'HEAD');
  if (divergent) {
    const tree = git(root, 'rev-parse', 'HEAD^{tree}');
    targetHead = git(root, '-c', 'user.name=Update tests', '-c', 'user.email=tests@example.invalid', 'commit-tree', tree, '-m', 'independent history');
    git(root, 'update-ref', 'refs/heads/incoming', targetHead);
  }
  git(root, 'checkout', 'main');
  git(base, 'clone', '--bare', root, remote);
  git(remote, 'update-ref', 'refs/heads/main', targetHead);
  git(root, 'remote', 'add', 'origin', `${UPDATE_REPOSITORY}.git`);
  put(root, 'config.json', 'my offer'); put(root, '.env', 'PRIVATE_VALUE=keep-me'); put(root, 'data/keep.txt', 'my contacts');
  put(root, 'web/dist/index.html', 'old interface'); put(root, 'node_modules/keep.txt', 'old dependency');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, root, remote, previousHead, targetHead };
}

function fakeRunner(f, { failInstall = false, failBuild = false, onBuilt } = {}) {
  const real = createCommandRunner();
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === 'git' && args[0] === 'ls-remote') return { code: 0, stdout: `${f.targetHead}\trefs/heads/main\n` };
    if (command === 'git' && args.includes('fetch')) {
      const copy = args.slice(); copy[copy.indexOf('origin')] = f.remote;
      return real(command, copy, options);
    }
    if (command === 'fake-npm') {
      if (args[0] === 'ci') {
        assert.deepEqual(args, ['ci', '--ignore-scripts']);
        if (failInstall) return { code: 1, stderr: 'a secret must never reach state or logs' };
        put(options.cwd, 'node_modules/new.txt', 'new dependency');
      } else if (args[0] === 'run' && args[1] === 'build') {
        if (failBuild) return { code: 1, stderr: 'a secret must never reach state or logs' };
        put(options.cwd, 'web/dist/index.html', 'new interface');
        await onBuilt?.();
      } else assert.fail('Unexpected npm command');
      return { code: 0, stdout: '' };
    }
    return real(command, args, options);
  };
  return { run, calls };
}

const npm = { command: 'fake-npm', prefix: [] };
function assertPrivateData(root) {
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), 'my offer');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'PRIVATE_VALUE=keep-me');
  assert.equal(readFileSync(join(root, 'data/keep.txt'), 'utf8'), 'my contacts');
}

test('only the expected repository and main branch are eligible; tracked changes block updates', async (t) => {
  const f = fixture(t);
  assert.equal((await inspectInstallation(f.root)).eligible, true);
  for (const origin of [`${UPDATE_REPOSITORY}.git`, 'git@github.com:renaud-bxl/prosper-et-les-prospects.git', 'ssh://git@github.com/renaud-bxl/prosper-et-les-prospects.git']) {
    git(f.root, 'remote', 'set-url', 'origin', origin);
    assert.equal((await inspectInstallation(f.root)).eligible, true);
  }
  git(f.root, 'remote', 'set-url', 'origin', `${UPDATE_REPOSITORY}-other.git`);
  assert.equal((await inspectInstallation(f.root)).reason, 'wrong_origin');
  git(f.root, 'remote', 'set-url', 'origin', `${UPDATE_REPOSITORY}.git`);
  git(f.root, 'checkout', '-b', 'my-work');
  assert.equal((await inspectInstallation(f.root)).reason, 'wrong_branch');
  git(f.root, 'checkout', 'main');
  put(f.root, 'version.txt', 'my changes');
  assert.equal((await inspectInstallation(f.root)).reason, 'dirty');
});

test('an app directory inside a different Git repository is not treated as an installation', async (t) => {
  const f = fixture(t);
  const child = join(f.root, 'nested'); mkdirSync(child);
  assert.equal((await inspectInstallation(child)).reason, 'not_git');
});

test('remote checks are cached, forceable and report the local and remote versions', async (t) => {
  const f = fixture(t), mock = fakeRunner(f);
  let now = Date.now();
  const service = createUpdateService({ root: f.root, run: mock.run, now: () => now, checkInterval: 1000 });
  let status = await service.getUpdateStatus();
  assert.equal(status.available, true); assert.equal(status.canUpdate, true);
  assert.equal(status.localHead, f.previousHead); assert.equal(status.remoteHead, f.targetHead);
  assert.ok(status.checkedAt); assert.ok(status.localDate);
  await service.getUpdateStatus();
  assert.equal(mock.calls.filter((c) => c.args[0] === 'ls-remote').length, 1);
  await service.getUpdateStatus({ force: true });
  now += 1001; await service.getUpdateStatus();
  assert.equal(mock.calls.filter((c) => c.args[0] === 'ls-remote').length, 3);
  status = await createUpdateService({ root: f.root, run: async (command, args, options) => args[0] === 'ls-remote' ? { code: 1, stdout: '' } : mock.run(command, args, options) }).getUpdateStatus();
  assert.equal(status.reason, 'network'); assert.equal(status.available, false);
});

test('divergent histories are reported and never become an update action', async (t) => {
  const f = fixture(t, { divergent: true }), mock = fakeRunner(f);
  const status = await createUpdateService({ root: f.root, run: mock.run }).getUpdateStatus();
  assert.equal(status.relation, 'diverged'); assert.equal(status.canUpdate, false);
});

test('the worker is launched only once, with IPC, and launch failures release its lock', async (t) => {
  const f = fixture(t), mock = fakeRunner(f);
  let options, args, worker;
  const service = createUpdateService({ root: f.root, run: mock.run,
    spawnWorker: (_command, argv, opts) => { args = argv; options = opts; worker = new EventEmitter(); worker.unref = () => {}; return worker; },
    exit: () => assert.fail('Server must not exit before a verified restart request'),
  });
  const job = await service.startUpdate({ port: 5599 });
  assert.equal(job.phase, 'queued'); assert.equal(service.isUpdating(), true);
  assert.equal(options.detached, true); assert.equal(options.stdio[3], 'ipc'); assert.ok(args.includes('5599'));
  await assert.rejects(service.startUpdate(), { code: 'busy' });
  worker.emit('error', new Error('could not spawn'));
  assert.equal(readUpdateJob(f.root).error, 'worker_failed');
  assert.equal(existsSync(updatePaths(f.root).lock), false);
});

test('successful preparation applies a fast-forward and swaps only generated dependencies and interface', async (t) => {
  const f = fixture(t), mock = fakeRunner(f), phases = [];
  const transaction = await applyUpdate({ ...f, run: mock.run, npm, onProgress: (p) => phases.push(p) });
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.targetHead);
  assert.equal(readFileSync(join(f.root, 'version.txt'), 'utf8'), 'new');
  assert.equal(readFileSync(join(f.root, 'web/dist/index.html'), 'utf8'), 'new interface');
  assert.equal(readFileSync(join(f.root, 'node_modules/new.txt'), 'utf8'), 'new dependency');
  assertPrivateData(f.root);
  assert.deepEqual(phases, ['checking', 'preparing', 'installing', 'building', 'applying']);
  assert.equal(git(f.root, 'status', '--porcelain', '--untracked-files=no'), '');
  await transaction.finalize();
  assert.equal(readdirSync(join(f.root, 'data')).some((p) => p.startsWith('.update-backup-') || p.startsWith('.update-stage-')), false);
});

test('install and build failures keep the original source, interface, dependencies and private data', async (t) => {
  for (const failure of ['install', 'build']) {
    const f = fixture(t), mock = fakeRunner(f, { failInstall: failure === 'install', failBuild: failure === 'build' });
    await assert.rejects(applyUpdate({ ...f, run: mock.run, npm }), { code: `${failure}_failed` });
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.previousHead);
    assert.equal(readFileSync(join(f.root, 'version.txt'), 'utf8'), 'old');
    assert.equal(readFileSync(join(f.root, 'web/dist/index.html'), 'utf8'), 'old interface');
    assert.equal(readFileSync(join(f.root, 'node_modules/keep.txt'), 'utf8'), 'old dependency');
    assertPrivateData(f.root);
    assert.equal(git(f.root, 'worktree', 'list', '--porcelain').split('worktree ').length - 1, 1);
  }
});

test('a failed restart can restore the source and generated assets without removing private data', async (t) => {
  const f = fixture(t), mock = fakeRunner(f);
  const transaction = await applyUpdate({ ...f, run: mock.run, npm });
  await transaction.rollback();
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.previousHead);
  assert.equal(readFileSync(join(f.root, 'web/dist/index.html'), 'utf8'), 'old interface');
  assert.equal(readFileSync(join(f.root, 'node_modules/keep.txt'), 'utf8'), 'old dependency');
  assertPrivateData(f.root);
  await transaction.rollback(); // idempotent, does not erase the restored directories
  assertPrivateData(f.root);
});

test('updates that track private paths or are not fast-forwards are rejected before installation', async (t) => {
  for (const [options, code] of [[{ protectedRemote: true }, 'protected_paths'], [{ divergent: true }, 'not_fast_forward']]) {
    const f = fixture(t, options), mock = fakeRunner(f);
    await assert.rejects(applyUpdate({ ...f, run: mock.run, npm }), { code });
    assert.equal(mock.calls.some((c) => c.command === 'fake-npm'), false);
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.previousHead);
    assertPrivateData(f.root);
  }
});

test('tracked edits made while the update is preparing prevent application and remain intact', async (t) => {
  const f = fixture(t), mock = fakeRunner(f, { onBuilt: () => put(f.root, 'version.txt', 'my new edit') });
  await assert.rejects(applyUpdate({ ...f, run: mock.run, npm }), { code: 'dirty' });
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.previousHead);
  assert.equal(readFileSync(join(f.root, 'version.txt'), 'utf8'), 'my new edit');
  assertPrivateData(f.root);
});

test('a stale owned job can be retried without deleting any other data', async (t) => {
  const f = fixture(t), mock = fakeRunner(f);
  const now = Date.now() + 31 * 60 * 1000;
  const previous = writeUpdateJob(f.root, { id: 'stale-job', phase: 'building', targetHead: f.targetHead });
  mkdirSync(updatePaths(f.root).lock); writeFileSync(join(updatePaths(f.root).lock, 'owner'), previous.id);
  const worker = new EventEmitter(); worker.unref = () => {};
  const service = createUpdateService({ root: f.root, run: mock.run, now: () => now, spawnWorker: () => worker });
  const status = await service.getUpdateStatus();
  assert.equal(status.job.phase, 'error'); assert.equal(status.job.error, 'worker_stopped');
  assert.equal(status.canUpdate, true);
  const next = await service.startUpdate();
  assert.notEqual(next.id, previous.id); assert.equal(next.phase, 'queued'); assertPrivateData(f.root);
  worker.emit('error', new Error('fixture cleanup'));
});
