import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, delimiter, isAbsolute, resolve } from 'node:path';
import { statSync, accessSync, constants, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { RedactionError, avecRepriseRedaction, diagnosticRedaction } from '../redaction-recovery.mjs';

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

function fichierExecutable(path) {
  try { return statSync(path).isFile() && (accessSync(path, constants.X_OK), true); }
  catch { return false; }
}

const probesCodex = new Map();
const flagsCodex = ['--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', '--json', '--output-schema'];

function verifierBundleCodex(binary, env, timeoutMs) {
  let stat;
  try { stat = statSync(binary); } catch { return { compatible: false, raison: 'verification_indisponible' }; }
  const key = `${binary}\0${stat.mtimeMs}\0${stat.size}\0${env.CODEX_HOME ?? ''}\0${timeoutMs}`;
  const cached = probesCodex.get(key);
  if (cached && Date.now() - cached.at < 15000) return cached.result;
  const run = (args) => spawnSync(binary, args, {
    env: envSansCleApi(env), encoding: 'utf8', input: '', shell: false,
    timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 128000, windowsHide: true,
  });
  const help = run(['exec', '--help']);
  const helpText = `${help.stdout ?? ''}\n${help.stderr ?? ''}`;
  let result;
  if (help.error || help.status !== 0 || !flagsCodex.every((flag) => helpText.includes(flag))) {
    result = { compatible: false, raison: help.error?.code === 'ETIMEDOUT' ? 'probe_timeout' : 'options_incompatibles' };
  } else {
    // Lecture locale uniquement. Le texte brut peut citer la configuration : il ne sort jamais de cette fonction.
    // Un ancien bundle peut accepter les options mais échouer à lire un modèle utilisateur récent.
    const login = run(['login', 'status']);
    const statusText = `${login.stdout ?? ''}\n${login.stderr ?? ''}`;
    if (login.status === 0) result = { compatible: true, authentification: 'connecte' };
    else if (!login.error && /\b(?:not logged in|not authenticated|logged out)\b/i.test(statusText)) {
      result = { compatible: true, authentification: 'absente' };
    } else result = { compatible: false, raison: login.error?.code === 'ETIMEDOUT' ? 'probe_timeout'
      : /(?:unknown variant|error loading config|failed to load config|invalid config)/i.test(statusText) ? 'configuration_incompatible' : 'verification_indisponible' };
  }
  probesCodex.set(key, { at: Date.now(), result });
  return result;
}

// Les chemins injectables servent aux tests isolés ; aucune route HTTP ne fournit ces options.
export function detecterMoteur(moteur, { env = process.env, home = homedir(), platform = process.platform,
  bundles = ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex'], probeTimeoutMs = 1500 } = {}) {
  if (!['claude', 'codex'].includes(moteur)) throw new Error('Moteur CLI inconnu.');
  const directories = (env.PATH ?? '').split(delimiter).filter((path) => isAbsolute(path));
  const paths = directories.map((path) => join(path, moteur));
  const variable = moteur === 'claude' ? 'CLAUDE_BIN' : 'CODEX_BIN';
  if (env[variable]) {
    // Une surcharge explicite reste prioritaire, même erronée : elle ne doit pas être masquée par un autre CLI.
    const value = env[variable];
    const binary = value.includes('/') || value.includes('\\') ? resolve(value)
      : directories.map((path) => join(path, value)).find(fichierExecutable) ?? value;
    return { binary, installe: fichierExecutable(binary), source: 'explicite' };
  }
  for (const [binary, source] of [...paths.map((path) => [path, 'path']), [join(home, '.local', 'bin', moteur), 'local']]) {
    if (fichierExecutable(binary)) return { binary, installe: true, source };
  }
  const refuses = [];
  if (moteur === 'codex' && platform === 'darwin') {
    const timeoutMs = Math.max(100, Math.min(1500, Number(probeTimeoutMs) || 1500));
    for (const binary of bundles) {
      if (!isAbsolute(binary) || !fichierExecutable(binary)) continue;
      const verification = verifierBundleCodex(binary, env, timeoutMs);
      if (verification.compatible) return { binary, installe: true, source: 'application', authentification: verification.authentification };
      refuses.push({ binary, raison: verification.raison });
    }
  }
  return { binary: moteur, installe: false, source: 'absent', ...(refuses.length ? { refuses } : {}) };
}

export function capacitesMoteurs(options = {}) {
  // Aucun appel modèle ; les bundles officiels sont contrôlés par leurs seules commandes d'aide et d'état local.
  return { claude: { installe: detecterMoteur('claude', options).installe }, codex: { installe: detecterMoteur('codex', options).installe } };
}

function binaire(moteur, options) {
  const detection = detecterMoteur(moteur, options);
  if (detection.refuses?.length) {
    const cause = detection.refuses.some((item) => item.raison === 'configuration_incompatible')
      ? 'sa version ne peut pas lire la configuration locale' : 'ses options ou son état de connexion n’ont pas pu être vérifiés';
    throw new RedactionError('engine_start_failed', `Codex CLI est présent dans une application officielle, mais ${cause}. Mettez le CLI à jour ou reconnectez-le. Aucun brouillon créé.`);
  }
  return detection.binary;
}

// Commandes vérifiées avec les aides officielles locales. Aucun shell n'interprète les arguments.
export function commandeRedaction(system, config, schemaPath, detectionOptions) {
  const { moteur, modele } = normaliserRedaction(config);
  if (moteur === 'aucun') throw new Error('La rédaction est désactivée : choisir Claude Code ou Codex pour préparer un mail.');
  if (moteur === 'claude') return {
    binary: binaire(moteur, detectionOptions),
    args: ['-p', '--safe-mode', '--output-format', 'json', '--tools', '', '--strict-mcp-config',
      '--disable-slash-commands', '--no-chrome', '--no-session-persistence',
      '--system-prompt', system, '--json-schema', JSON.stringify(SCHEMA_BROUILLON),
      ...(modele ? ['--model', modele] : [])],
  };
  const sansOutils = ['shell_tool', 'apps', 'multi_agent', 'hooks', 'remote_plugin', 'plugins', 'code_mode',
    'browser_use', 'computer_use', 'image_generation', 'view_image', 'goals', 'memories', 'shell_snapshot'];
  return {
    binary: binaire(moteur, detectionOptions),
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

function authentificationRequise(value) {
  if (!value || typeof value !== 'object') return false;
  const codes = ['unauthorized', 'not_logged_in', 'authentication_required', 'authentication_error', 'invalid_api_key', 'token_expired', 'refresh_token_expired', 'refresh_token_reused'];
  const code = String(value.code ?? value.error?.code ?? value.codexErrorInfo ?? '').toLowerCase();
  if (codes.includes(code) || value.httpStatusCode === 401) return true;
  // Le JSONL exec officiel expose aussi des erreurs avec un simple champ message.
  // Seuls des préfixes d'authentification canoniques sont reconnus, sans conserver leur contenu.
  const message = String(value.message ?? value.error?.message ?? '').slice(0, 4000);
  return /^(?:error:\s*)?(?:not logged in\b|authentication required\b|unauthorized\b|your (?:access|refresh) token (?:has expired|could not be refreshed)\b|token refresh failed\b|refresh token (?:has expired|was already used)\b|unexpected status 401\b)/i.test(message.trim());
}

function erreurAuthentification(moteur) {
  return new RedactionError('engine_auth_required', moteur === 'codex'
    ? 'Codex demande une connexion valide à votre compte ChatGPT. Reconnectez ce compte dans Codex ou son CLI avant de reprendre les mails manquants.'
    : 'Claude Code demande une connexion valide à votre abonnement Claude. Reconnectez ce compte avant de reprendre les mails manquants.');
}

const TYPES_EVENEMENTS = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']);
function resumeEvenements(output) {
  const evenements = {}; let dernier_evenement, auth = false;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    const type = TYPES_EVENEMENTS.has(event?.type) ? event.type : 'inconnu';
    evenements[type] = (evenements[type] ?? 0) + 1; dernier_evenement = type;
    if ((event?.type === 'error' || event?.type === 'turn.failed') && authentificationRequise(event.error ?? event)) auth = true;
  }
  return { evenements, dernier_evenement, auth };
}

export function lireSortieMoteur(moteur, output) {
  if (moteur === 'claude') {
    const result = JSON.parse(output);
    if (result.is_error && authentificationRequise(result)) throw erreurAuthentification(moteur);
    if (result.is_error) throw new RedactionError('engine_reported_error', 'Claude Code a signalé une erreur de rédaction. Vérifiez la connexion et le modèle choisi.');
    return validerBrouillon(result.structured_output ?? JSON.parse(result.result));
  }
  const events = output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (events.some((event) => (event.type === 'error' || event.type === 'turn.failed') && authentificationRequise(event.error ?? event))) throw erreurAuthentification(moteur);
  if (events.some((event) => event.type === 'error' || event.type === 'turn.failed')) throw new RedactionError('engine_reported_error', 'Codex a interrompu la rédaction. Vérifiez la connexion ChatGPT et le modèle choisi.');
  // Les versions CLI peuvent exposer quelques outils internes malgré les options ci-dessus.
  // Un événement d'action n'est jamais accepté comme source d'un brouillon.
  const safeItems = new Set(['agent_message', 'reasoning']);
  if (events.some((event) => event.item && !safeItems.has(event.item.type))) throw new RedactionError('tool_use_blocked', 'Rédaction interrompue : le moteur a tenté d’utiliser un outil.');
  const last = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1);
  if (!last || !events.some((event) => event.type === 'turn.completed')) throw new RedactionError('incomplete_output', 'Codex n’a pas terminé son brouillon.');
  return validerBrouillon(JSON.parse(last.item.text));
}

function envSansCleApi(source = process.env) {
  const env = { ...source };
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
  const debut = Date.now();
  let out = '', stdoutBytes = 0, stderrBytes = 0, firstActivity = null, lastActivity = null, stderrAuth = false, stderrTail = '', exitCode, exitSignal;
  const activity = () => { const elapsed = Date.now() - debut; firstActivity ??= elapsed; lastActivity = elapsed; };
  const diagnostic = () => {
    const stream = moteur === 'codex' ? resumeEvenements(out) : { evenements: {} };
    return diagnosticRedaction({ moteur, duree_ms: Date.now() - debut, timeout_ms: timeoutMs,
      stdout_octets: stdoutBytes, stderr_octets: stderrBytes, premiere_activite_ms: firstActivity,
      derniere_activite_ms: lastActivity, silence_ms: Date.now() - debut - (lastActivity ?? 0),
      activite: stdoutBytes ? stderrBytes ? 'stdout_stderr' : 'stdout' : stderrBytes ? 'stderr' : 'aucune',
      evenements: stream.evenements, dernier_evenement: stream.dernier_evenement,
      ...((stderrAuth || stream.auth) ? { code_cli: 'auth_required' } : {}), exit_code: exitCode, signal: exitSignal });
  };
  try {
    const { binary, args } = commandeRedaction(system, config, schemaPath);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd, env: envSansCleApi(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      let size = 0, settled = false, killer, stoppingError = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const stop = (error) => {
        if (settled || stoppingError) return;
        // Un CLI qui a déjà signalé une connexion invalide ne doit jamais être relancé comme un simple délai.
        if (error.code === 'redaction_timeout' && (stderrAuth || resumeEvenements(out).auth)) error = erreurAuthentification(moteur);
        stoppingError = error;
        clearTimeout(timer);
        child.kill('SIGTERM');
        killer = setTimeout(() => child.kill('SIGKILL'), 1000);
        killer.unref();
      };
      const timer = setTimeout(() => stop(new RedactionError('redaction_timeout', `${moteur === 'claude' ? 'Claude Code' : 'Codex'} : délai de rédaction dépassé (${timeoutMs / 1000} s).`, { retryable: true })), timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length; activity();
        size += chunk.length;
        if (size > 1_000_000) return stop(new RedactionError('output_too_large', 'Sortie du moteur trop volumineuse.'));
        out += chunk;
      });
      // Le texte brut de stderr peut contenir des données du site ou des détails d'authentification.
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length; activity(); size += chunk.length;
        // Fenêtre éphémère bornée, uniquement pour reconnaître une erreur de connexion canonique.
        // Ni cette fenêtre ni stderr ne sont renvoyés dans les événements ou la base.
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096);
        stderrAuth ||= stderrTail.split(/\r?\n/).some(message => authentificationRequise({ message }));
        if (size > 1_000_000) stop(new RedactionError('output_too_large', 'Sortie du moteur trop volumineuse.'));
      });
      child.stdin.on('error', () => {}); // Le processus peut refuser sa configuration avant la lecture du prompt.
      child.on('error', (error) => finish(new RedactionError(error.code === 'ENOENT' ? 'engine_missing' : 'engine_start_failed', error.code === 'ENOENT'
        ? `${moteur === 'claude' ? 'Claude Code' : 'Codex CLI'} introuvable. Installez-le et connectez votre abonnement, puis relancez.`
        : `Impossible de démarrer ${moteur} (${error.code ?? 'erreur système'}).`)));
      child.on('exit', (code, signal) => {
        exitCode = code; exitSignal = signal;
        if (!stoppingError) return;
        clearTimeout(killer);
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        finish(stoppingError); // La reprise ne peut commencer qu'après la sortie effective de ce CLI.
      });
      child.on('close', (code, signal) => {
        exitCode = code; exitSignal = signal;
        clearTimeout(killer);
        if (stoppingError) return finish(stoppingError);
        if (code !== 0) return finish(stderrAuth || resumeEvenements(out).auth ? erreurAuthentification(moteur)
          : new RedactionError('engine_exit_failed', `${moteur === 'claude' ? 'Claude Code' : 'Codex'} a échoué (${signal ?? `code ${code}`}). Vérifiez la version du CLI, sa connexion et le modèle choisi. Aucun brouillon créé.`));
        finish(null, out);
      });
      child.stdin.end(prompt);
    });
    try { return { ...lireSortieMoteur(moteur, output), duree_ms: Date.now() - debut, moteur }; }
    catch (error) {
      if (error instanceof SyntaxError) throw new RedactionError('invalid_json', `${moteur} a rendu une sortie JSON invalide. Aucun brouillon créé.`);
      throw error;
    }
  } catch (error) {
    if (error instanceof RedactionError) error.diagnostic = diagnostic();
    throw error;
  } finally { stderrTail = ''; rmSync(cwd, { recursive: true, force: true }); }
}

export async function executerRedaction(system, prompt, config = {}) {
  const { timeoutMs } = normaliserRedaction(config);
  const debut = Date.now();
  const result = await avecRepriseRedaction(({ timeoutMs: limit }) => executerUneRedaction(system, prompt, { ...config, timeout_ms: limit }), { timeoutMs, onRetry: config.onRetry });
  return { ...result, duree_ms: Date.now() - debut };
}
