import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = ['powershell.exe', 'pwsh.exe'].find((candidate) => process.platform === 'win32' && spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0);
const skip = !binary && 'Tests natifs Windows : PowerShell Windows indisponible sur cette machine.';
const script = resolve(import.meta.dirname, '../install.ps1');
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
function powershell(code) {
  return spawnSync(binary, ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', windowsHide: true });
}

test('Windows : choix exact avec espaces, confirmation explicite et refus des cibles existantes', { skip }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'prosper-windows-installer-'));
  try {
    const exact = join(temporary, 'Dossier choisi exactement');
    const file = join(temporary, 'un fichier.txt'); writeFileSync(file, 'keep');
    const nonempty = join(temporary, 'nonempty'); mkdirSync(nonempty); writeFileSync(join(nonempty, 'keep.txt'), 'keep');
    const result = powershell(`. ${quote(script)}; $target=${quote(exact)}; if((Resolve-ProsperDestination $target) -cne $target){throw 'Exact destination changed'}; Assert-ProsperDestination $target; if(Test-Path -LiteralPath $target){throw 'Validation created a directory'}; if(-not(Test-ProsperConfirmation 'INSTALLER')){throw 'Confirmation rejected'}; foreach($answer in @('', 'oui', 'no', '1')){if(Test-ProsperConfirmation $answer){throw 'Unsafe confirmation accepted'}}; foreach($bad in @(${quote(file)},${quote(nonempty)})){ $blocked=$false;try{Assert-ProsperDestination $bad}catch{$blocked=$true};if(-not$blocked){throw 'Existing target accepted'}}`);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('Windows : une entree non interactive ne lance aucune installation', { skip }, () => {
  const result = powershell(`& ${quote(script)}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /console interactive|entree redirigee/i);
});

test('Windows : une jonction est refusee sans toucher a son contenu', { skip }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'prosper-windows-junction-'));
  const target = join(temporary, 'target'), link = join(temporary, 'junction');
  mkdirSync(target); writeFileSync(join(target, 'keep.txt'), 'keep');
  try {
    const result = powershell(`. ${quote(script)}; New-Item -ItemType Junction -Path ${quote(link)} -Target ${quote(target)} | Out-Null; $blocked=$false; try{Assert-ProsperDestination ${quote(link)}}catch{$blocked=$true};if(-not$blocked){throw 'Junction accepted'};if((Get-Content -LiteralPath ${quote(join(target, 'keep.txt'))}) -ne 'keep'){throw 'Target modified'}`);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
