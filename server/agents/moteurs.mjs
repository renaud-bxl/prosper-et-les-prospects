import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { existsSync, accessSync, constants, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { RedactionError, avecRepriseRedaction } from '../redaction-recovery.mjs';

export const SCHEMA_BROUILLON = {
  type: 'object',
  properties: {
    constat: { type: 'string', description: 'Une observation concrète justifiée par les données.' },
    objet: { type: 'string', description: 'Objet du mail de 7 mots au plus.' },
    mail: { type: 'string', description: 'Corps du mail, phrase de refus et signature comprises.' },
  },
  required: ['constat', 'objet', 'mail'],
  additionalProperties: false,
};

export function normaliserRedaction(config = {}) {
  const moteur = config.moteur ?? 'claude';
  const langue = config.langue ?? 'auto';
  if (!['claude', 'codex', 'aucun'].includes(moteur)) throw new Error('Moteur de rédaction inconnu : choisir claude, codex ou aucun.');
  if (!['fr', 'nl', 'en', 'auto'].includes(langue)) throw new Error('Langue de rédaction inconnue : choisir fr, nl, en ou auto.');
  const modele = String(config.modele ?? '').trim();
  if (modele.length > 120 || /[\r\n\0]/.test(modele)) throw new Error('Nom de modèle invalide.');
  const timeoutMs = config.timeout_ms ?? 90000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('Délai de rédaction invalide (1 à 300 secondes).');
  return { moteur, langue, modele, timeoutMs };
}

function binaire(moteur) {
  const variable = moteur === 'claude' ? 'CLAUDE_BIN' : 'CODEX_BIN';
  if (process.env[variable]) return process.env[variable];
  const local = join(homedir(), '.local', 'bin', moteur);
  return existsSync(local) ? local : moteur;
}

export function capacitesMoteurs() {
  const executable = (binary) => {
    const paths = binary.includes('/') || binary.includes('\\') ? [binary]
      : (process.env.PATH ?? '').split(delimiter).map((path) => join(path, binary));
    return paths.some((path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
  };
  // Présence du programme seulement : ni authentification ni requête modèle.
  return { claude: { installe: executable(binaire('claude')) }, codex: { installe: executable(binaire('codex')) } };
}

// Commandes vérifiées avec les aides officielles locales. Aucun shell n'interprète les arguments.
export function commandeRedaction(system, config, schemaPath) {
  const { moteur, modele } = normaliserRedaction(config);
  if (moteur === 'aucun') throw new Error('La rédaction est désactivée : choisir Claude Code ou Codex pour préparer un mail.');
  if (moteur === 'claude') return {
    binary: binaire(moteur),
    args: ['-p', '--safe-mode', '--output-format', 'json', '--tools', '', '--strict-mcp-config',
      '--disable-slash-commands', '--no-chrome', '--no-session-persistence',
      '--system-prompt', system, '--json-schema', JSON.stringify(SCHEMA_BROUILLON),
      ...(modele ? ['--model', modele] : [])],
  };
  const sansOutils = ['shell_tool', 'apps', 'multi_agent', 'hooks', 'remote_plugin', 'plugins', 'code_mode',
    'browser_use', 'computer_use', 'image_generation', 'view_image', 'goals', 'memories', 'shell_snapshot'];
  return {
    binary: binaire(moteur),
    args: ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only',
      '--json', '--color', 'never', '--output-schema', schemaPath,
      '--config', 'approval_policy="never"', '--config', 'forced_login_method="chatgpt"',
      '--config', 'web_search="disabled"', '--config', 'mcp_servers={}',
      '--config', 'project_doc_max_bytes=0', '--config', `developer_instructions=${JSON.stringify(system)}`,
      ...sansOutils.flatMap((feature) => ['--disable', feature]),
      ...(modele ? ['--model', modele] : []), '-'],
  };
}

export function validerBrouillon(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ['constat', 'objet', 'mail'].some((key) => typeof value[key] !== 'string' || !value[key].trim())) {
    throw new RedactionError('invalid_draft', 'Le moteur n’a pas rendu un brouillon JSON complet (constat, objet, mail).');
  }
  if (value.constat.length > 2000 || value.objet.length > 300 || value.mail.length > 12000) throw new RedactionError('invalid_draft', 'Brouillon trop long : sortie du moteur refusée.');
  return Object.fromEntries(['constat', 'objet', 'mail'].map((key) => [key, value[key].trim()]));
}

export function lireSortieMoteur(moteur, output) {
  if (moteur === 'claude') {
    const result = JSON.parse(output);
    if (result.is_error) throw new RedactionError('engine_reported_error', 'Claude Code a signalé une erreur de rédaction. Vérifiez la connexion et le modèle choisi.');
    return validerBrouillon(result.structured_output ?? JSON.parse(result.result));
  }
  const events = output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (events.some((event) => event.type === 'error' || event.type === 'turn.failed')) throw new RedactionError('engine_reported_error', 'Codex a interrompu la rédaction. Vérifiez la connexion ChatGPT et le modèle choisi.');
  // Les versions CLI peuvent exposer quelques outils internes malgré les options ci-dessus.
  // Un événement d'action n'est jamais accepté comme source d'un brouillon.
  const safeItems = new Set(['agent_message', 'reasoning']);
  if (events.some((event) => event.item && !safeItems.has(event.item.type))) throw new RedactionError('tool_use_blocked', 'Rédaction interrompue : le moteur a tenté d’utiliser un outil.');
  const last = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1);
  if (!last || !events.some((event) => event.type === 'turn.completed')) throw new RedactionError('incomplete_output', 'Codex n’a pas terminé son brouillon.');
  return validerBrouillon(JSON.parse(last.item.text));
}

function envSansCleApi() {
  const env = { ...process.env };
  for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[name];
  return env;
}

async function executerUneRedaction(system, prompt, config = {}) {
  const { moteur, timeoutMs } = normaliserRedaction(config);
  if (moteur === 'aucun') throw new Error('La rédaction est désactivée.');
  const cwd = mkdtempSync(join(tmpdir(), 'oscar-redacteur-'));
  const schemaPath = join(cwd, 'brouillon.schema.json');
  writeFileSync(schemaPath, JSON.stringify(SCHEMA_BROUILLON), { mode: 0o600 });
  const { binary, args } = commandeRedaction(system, config, schemaPath);
  const debut = Date.now();
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd, env: envSansCleApi(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      let out = '', size = 0, settled = false, killer, stoppingError = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const stop = (error) => {
        if (settled || stoppingError) return;
        stoppingError = error;
        clearTimeout(timer);
        child.kill('SIGTERM');
        killer = setTimeout(() => child.kill('SIGKILL'), 1000);
        killer.unref();
      };
      const timer = setTimeout(() => stop(new RedactionError('redaction_timeout', `${moteur === 'claude' ? 'Claude Code' : 'Codex'} : délai de rédaction dépassé (${timeoutMs / 1000} s).`, { retryable: true })), timeoutMs);
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) return stop(new RedactionError('output_too_large', 'Sortie du moteur trop volumineuse.'));
        out += chunk;
      });
      // Le texte brut de stderr peut contenir des données du site ou des détails d'authentification.
      child.stderr.on('data', (chunk) => { size += chunk.length; if (size > 1_000_000) stop(new RedactionError('output_too_large', 'Sortie du moteur trop volumineuse.')); });
      child.stdin.on('error', () => {}); // Le processus peut refuser sa configuration avant la lecture du prompt.
      child.on('error', (error) => finish(new RedactionError(error.code === 'ENOENT' ? 'engine_missing' : 'engine_start_failed', error.code === 'ENOENT'
        ? `${moteur === 'claude' ? 'Claude Code' : 'Codex CLI'} introuvable. Installez-le et connectez votre abonnement, puis relancez.`
        : `Impossible de démarrer ${moteur} (${error.code ?? 'erreur système'}).`)));
      child.on('exit', () => {
        if (!stoppingError) return;
        clearTimeout(killer);
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        finish(stoppingError); // La reprise ne peut commencer qu'après la sortie effective de ce CLI.
      });
      child.on('close', (code, signal) => {
        clearTimeout(killer);
        if (stoppingError) return finish(stoppingError);
        if (code !== 0) return finish(new RedactionError('engine_exit_failed', `${moteur === 'claude' ? 'Claude Code' : 'Codex'} a échoué (${signal ?? `code ${code}`}). Vérifiez la version du CLI, sa connexion et le modèle choisi. Aucun brouillon créé.`));
        finish(null, out);
      });
      child.stdin.end(prompt);
    });
    try { return { ...lireSortieMoteur(moteur, output), duree_ms: Date.now() - debut, moteur }; }
    catch (error) {
      if (error instanceof SyntaxError) throw new RedactionError('invalid_json', `${moteur} a rendu une sortie JSON invalide. Aucun brouillon créé.`);
      throw error;
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

export async function executerRedaction(system, prompt, config = {}) {
  const { timeoutMs } = normaliserRedaction(config);
  const debut = Date.now();
  const result = await avecRepriseRedaction(({ timeoutMs: limit }) => executerUneRedaction(system, prompt, { ...config, timeout_ms: limit }), { timeoutMs, onRetry: config.onRetry });
  return { ...result, duree_ms: Date.now() - debut };
}
