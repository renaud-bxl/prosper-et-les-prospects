import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script=resolve('install.sh');
const python=spawnSync('python3',['--version'],{encoding:'utf8'}).status===0?'python3':null;
const driver=String.raw`
import os,sys,json,pty,select,time,signal,subprocess
plan=json.load(open(sys.argv[1]))
if plan.get('headless'):
 r=subprocess.run(['/bin/sh',os.environ['PROSPER_TEST_SCRIPT']],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 sys.stdout.buffer.write(r.stdout);sys.exit(r.returncode)
pid,fd=pty.fork()
if pid==0:
 os.execve('/bin/sh',['sh','-c','cat "$PROSPER_TEST_SCRIPT" | sh'],os.environ)
output=b'';position=0;step=0;deadline=time.monotonic()+12
try:
 while time.monotonic()<deadline:
  if select.select([fd],[],[],0.1)[0]:
   try:chunk=os.read(fd,65536)
   except OSError:break
   if not chunk:break
   output+=chunk
  if step<len(plan['actions']):
   action=plan['actions'][step];mark=action['wait'].encode()
   index=output.find(mark,position)
   if index!=-1:
    for path in action.get('absent',[]):
     if os.path.lexists(path):raise Exception('Mutation before confirmation: '+path)
    for path in action.get('removeEmpty',[]):os.rmdir(path)
    position=index+len(mark);os.write(fd,action['send'].encode());step+=1
  done,status=os.waitpid(pid,os.WNOHANG)
  if done:
   # Drain the PTY before returning all visible prompts/output.
   while select.select([fd],[],[],0)[0]:
    try:output+=os.read(fd,65536)
    except OSError:break
   sys.stdout.buffer.write(output)
   if step!=len(plan['actions']):raise Exception('Some expected prompts were not reached')
   sys.exit(os.waitstatus_to_exitcode(status))
 else:raise Exception('Installer prompt timed out')
 done,status=os.waitpid(pid,0)
 sys.stdout.buffer.write(output)
 if step!=len(plan['actions']):raise Exception('Some expected prompts were not reached')
 sys.exit(os.waitstatus_to_exitcode(status))
except Exception as error:
 try:os.killpg(pid,signal.SIGKILL)
 except ProcessLookupError:pass
 sys.stdout.buffer.write(output);print('\nFIXTURE FAILURE:',error);sys.exit(97)
`;
async function fixture(t,{version='22.13.0',system='Darwin'}={}) {
 const base=await mkdtemp(join(await realpath(tmpdir()),'prosper-install-'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const bin=join(base,'bin'),home=join(base,'home'),mounts=join(base,'disques montés'),logs=join(base,'logs');
 await Promise.all([bin,home,mounts,logs].map(p=>mkdir(p)));
 const commands={
  node:`printf '%s\\n' '${version}'`,
  uname:`printf '%s\\n' '${system}'`,
  stat:'for arg in "$@"; do path=$arg; done\ncase "$path" in "$PROSPER_INSTALL_TEST_MOUNTS"/*) printf "42\\n";; *) printf "1\\n";; esac',
  git:'if [ "$*" = --version ]; then printf "git version QA\\n"; exit 0; fi\nprintf "%s\\n" "$@" > "$PROSPER_TEST_LOG/git-args"\nfor arg in "$@"; do target=$arg; done\nprintf "{}\\n" > "$target/package.json"',
  npm:'if [ "$*" = --version ]; then printf "10.9.0\\n"; exit 0; fi\nprintf "%s\\n" "$*" >> "$PROSPER_TEST_LOG/npm-args"\nif [ "${PROSPER_TEST_NPM_FAIL:-}" = "$*" ]; then exit 9; fi',
 };
 await Promise.all(Object.entries(commands).map(([name,body])=>writeFile(join(bin,name),'#!/bin/sh\nset -eu\n'+body+'\n',{mode:0o755})));
 const driverFile=join(base,'driver.py');await writeFile(driverFile,driver);
 const env={PATH:bin+':/usr/bin:/bin',HOME:home,PROSPER_INSTALL_TESTING:'1',PROSPER_INSTALL_TEST_MOUNTS:mounts,PROSPER_TEST_LOG:logs,PROSPER_TEST_SCRIPT:script};
 return {base,bin,home,mounts,logs,env,async run(actions,extra={}){const plan=join(base,'plan.json');await writeFile(plan,JSON.stringify({actions,...extra}));return spawnSync(python,[driverFile,plan],{env:{...process.env,...env},encoding:'utf8',timeout:18000});}};
}
async function exists(path){try{await access(path);return true;}catch{return false;}}
const ttyOptions={skip:!python||process.platform==='win32'};

test('installer pipe reads the real PTY, lists disk names and preserves spaces after consent',ttyOptions,async t=>{
 const f=await fixture(t);const disk=join(f.mounts,'Mon SSD de test');await mkdir(disk);
 const target=join(disk,'Prosper et les prospects');
 const result=await f.run([{wait:'Votre choix [1] : ',send:'2\n',absent:[target,join(f.logs,'git-args')]},{wait:'[o/N] : ',send:'oui\n',absent:[target,join(f.logs,'git-args')]}]);
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/Mon SSD de test/);assert.ok(result.stdout.includes(target));
 assert.deepEqual((await readFile(join(f.logs,'git-args'),'utf8')).trim().split('\n'),['clone','--branch','main','--single-branch','--','https://github.com/renaud-bxl/prosper-et-les-prospects.git',target]);
 assert.equal(await readFile(join(f.logs,'npm-args'),'utf8'),'ci\nrun build\nstart\n');
});

test('Documents is offered locally and cancellation creates no project files',ttyOptions,async t=>{
 const f=await fixture(t);const target=join(f.home,'Documents','Prosper et les prospects');
 const result=await f.run([{wait:'Votre choix [1] : ',send:'\n'},{wait:'[o/N] : ',send:'n\n',absent:[target,join(f.logs,'git-args')]}]);
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/Documents de cet ordinateur/);assert.equal(await exists(join(f.home,'Documents')),false);assert.equal(await exists(join(f.logs,'git-args')),false);
});

test('Linux custom path is exact, quoted and accepts literal shell characters without evaluation',ttyOptions,async t=>{
 const f=await fixture(t,{system:'Linux'});const target=join(f.base,"Projet d'été $(touch HACK) ; bureau");
 const result=await f.run([{wait:'Votre choix [1] : ',send:'2\n'},{wait:'dossier exact à créer pour Prosper : ',send:target+'\n'},{wait:'[o/N] : ',send:'o\n',absent:[target]}]);
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(await exists(join(target,'package.json')),true);assert.equal(await exists(join(f.base,'HACK')),false);assert.ok((await readFile(join(f.logs,'git-args'),'utf8')).endsWith(target+'\n'));
});

test('interrupted confirmation fails closed before any mutation',ttyOptions,async t=>{
 const f=await fixture(t);const target=join(f.home,'Documents','Prosper et les prospects');
 const result=await f.run([{wait:'Votre choix [1] : ',send:'1\n'},{wait:'[o/N] : ',send:'\u0004',absent:[target]}]);
 assert.notEqual(result.status,0,result.stdout+result.stderr);assert.equal(await exists(target),false);assert.equal(await exists(join(f.logs,'git-args')),false);
});

test('an existing hidden file is never replaced',ttyOptions,async t=>{
 const f=await fixture(t);const target=join(f.home,'Documents','Prosper et les prospects');await mkdir(target,{recursive:true});await writeFile(join(target,'.precious'),'keep');
 const result=await f.run([{wait:'Votre choix [1] : ',send:'1\n'}]);
 assert.notEqual(result.status,0);assert.match(result.stdout,/contient déjà des fichiers/);assert.equal(await readFile(join(target,'.precious'),'utf8'),'keep');assert.equal(await exists(join(f.logs,'git-args')),false);
});

test('symlink destination is refused without following it',ttyOptions,async t=>{
 const f=await fixture(t);await mkdir(join(f.home,'Documents'));const real=join(f.base,'real');await mkdir(real);await symlink(real,join(f.home,'Documents','Prosper et les prospects'));
 const result=await f.run([{wait:'Votre choix [1] : ',send:'1\n'}]);
 assert.notEqual(result.status,0);assert.match(result.stdout,/lien symbolique/);assert.equal(await exists(join(f.logs,'git-args')),false);
});

test('Node 22.12 is rejected before the location choice',ttyOptions,async t=>{
 const f=await fixture(t,{version:'22.12.0'});const result=await f.run([]);
 assert.notEqual(result.status,0);assert.match(result.stdout,/trop ancien/);assert.doesNotMatch(result.stdout,/Votre choix/);assert.equal(await exists(join(f.logs,'git-args')),false);
});

test('without a controlling terminal installer fails before creating or downloading',ttyOptions,async t=>{
 const f=await fixture(t);const result=await f.run([],{headless:true});
 assert.notEqual(result.status,0);assert.match(result.stdout,/Aucun terminal interactif/);assert.equal(await exists(join(f.logs,'git-args')),false);assert.equal(await exists(join(f.home,'Documents')),false);
});

test('dependency failure preserves installed files and prevents build/start',ttyOptions,async t=>{
 const f=await fixture(t);f.env.PROSPER_TEST_NPM_FAIL='ci';const target=join(f.home,'Documents','Prosper et les prospects');
 const result=await f.run([{wait:'Votre choix [1] : ',send:'1\n'},{wait:'[o/N] : ',send:'o\n'}]);
 assert.notEqual(result.status,0);assert.equal(await exists(join(target,'package.json')),true);assert.equal(await readFile(join(f.logs,'npm-args'),'utf8'),'ci\n');assert.match(result.stdout,/dossier est conservé/);
});

test('a disk disconnected during confirmation is never recreated on the local disk',ttyOptions,async t=>{
 const f=await fixture(t);const disk=join(f.mounts,'SSD amovible');await mkdir(disk);
 const result=await f.run([{wait:'Votre choix [1] : ',send:'2\n'},{wait:'[o/N] : ',send:'o\n',removeEmpty:[disk]}]);
 assert.notEqual(result.status,0);assert.match(result.stdout,/disque choisi n’est plus monté/);assert.equal(await exists(disk),false);assert.equal(await exists(join(f.logs,'git-args')),false);
});
