// Notification autonome ; le serveur vérifie GitHub au maximum toutes les 30 minutes.
const TEXT = {
  fr: {
    available: 'Une nouvelle version est disponible.', update: 'Mettre à jour', check: 'Vérifier', later: 'Plus tard',
    checking: 'Vérification de la version…', queued: 'La mise à jour va commencer…', preparing: 'Préparation de la mise à jour…',
    installing: 'Installation de la nouvelle version…', building: 'Préparation de l’interface…', applying: 'Application de la mise à jour…',
    restarting: 'Redémarrage de Prosper… La page se reconnecte automatiquement.', complete: 'Prosper est à jour.',
    current: 'Version à jour', checked: 'Dernière vérification', failed: 'La mise à jour n’a pas abouti. Tu peux réessayer.',
    dirty: 'Des fichiers de l’application ont été modifiés. Enregistre ces modifications dans Git avant de mettre à jour.',
    wrong_branch: 'La mise à jour fonctionne depuis la branche main.', wrong_origin: 'Cette copie utilise un autre dépôt GitHub.',
    not_git: 'Les mises à jour sont disponibles pour une installation depuis le dépôt GitHub.',
    network: 'GitHub est momentanément inaccessible. Une nouvelle vérification aura lieu automatiquement.',
    diverged: 'Les versions locale et GitHub ont divergé. Une mise à jour automatique serait risquée.',
    not_fast_forward: 'La mise à jour ne peut pas être appliquée sans modifier ton historique Git.',
    protected_paths: 'La version distante contient des fichiers de données locales. La mise à jour est bloquée.',
    mission_active: 'Termine la mission en cours avant de mettre à jour.', busy: 'Une mise à jour est déjà en cours.',
    no_update: 'Prosper est déjà à jour.', install_failed: 'L’installation a échoué. La version actuelle est conservée.',
    build_failed: 'La préparation de l’interface a échoué. La version actuelle est conservée.',
    restart_failed: 'Le redémarrage a échoué. La version précédente a été restaurée.',
    rollback_source_failed: 'La restauration demande une intervention : des fichiers ont été modifiés pendant la mise à jour.',
    retry: 'Réessayer', version: 'Version',
  },
  nl: {
    available: 'Er is een nieuwe versie beschikbaar.', update: 'Bijwerken', check: 'Controleren', later: 'Later',
    checking: 'Versie controleren…', queued: 'De update begint zo…', preparing: 'Update voorbereiden…',
    installing: 'Nieuwe versie installeren…', building: 'Interface voorbereiden…', applying: 'Update toepassen…',
    restarting: 'Prosper wordt herstart… De pagina maakt automatisch opnieuw verbinding.', complete: 'Prosper is bijgewerkt.',
    current: 'Versie is actueel', checked: 'Laatst gecontroleerd', failed: 'De update is niet gelukt. Je kunt opnieuw proberen.',
    dirty: 'Appbestanden zijn gewijzigd. Sla deze wijzigingen op in Git voordat je bijwerkt.',
    wrong_branch: 'Automatisch bijwerken werkt vanaf de main-branch.', wrong_origin: 'Deze kopie gebruikt een andere GitHub-repository.',
    not_git: 'Updates zijn beschikbaar voor een installatie vanuit de GitHub-repository.',
    network: 'GitHub is tijdelijk onbereikbaar. Er volgt automatisch een nieuwe controle.',
    diverged: 'De lokale en GitHub-versies zijn uit elkaar gelopen. Automatisch bijwerken is niet veilig.',
    not_fast_forward: 'Deze update kan niet worden toegepast zonder je Git-geschiedenis te wijzigen.',
    protected_paths: 'De externe versie bevat lokale gegevensbestanden. De update is geblokkeerd.',
    mission_active: 'Rond de huidige missie af voordat je bijwerkt.', busy: 'Er wordt al een update uitgevoerd.',
    no_update: 'Prosper is al bijgewerkt.', install_failed: 'Installatie mislukt. De huidige versie blijft behouden.',
    build_failed: 'De interface kon niet worden voorbereid. De huidige versie blijft behouden.',
    restart_failed: 'Herstart mislukt. De vorige versie is hersteld.',
    rollback_source_failed: 'Herstel vereist hulp: bestanden zijn tijdens de update gewijzigd.',
    retry: 'Opnieuw proberen', version: 'Versie',
  },
  en: {
    available: 'A new version is available.', update: 'Update', check: 'Check', later: 'Later',
    checking: 'Checking the version…', queued: 'The update will start shortly…', preparing: 'Preparing the update…',
    installing: 'Installing the new version…', building: 'Preparing the interface…', applying: 'Applying the update…',
    restarting: 'Restarting Prosper… This page will reconnect automatically.', complete: 'Prosper is up to date.',
    current: 'Version is up to date', checked: 'Last checked', failed: 'The update did not finish. You can try again.',
    dirty: 'Application files have changed. Save these changes in Git before updating.',
    wrong_branch: 'Automatic updates work from the main branch.', wrong_origin: 'This copy uses another GitHub repository.',
    not_git: 'Updates are available for an installation cloned from the GitHub repository.',
    network: 'GitHub is temporarily unavailable. Another check will happen automatically.',
    diverged: 'The local and GitHub versions have diverged. An automatic update would be unsafe.',
    not_fast_forward: 'This update cannot be applied without changing your Git history.',
    protected_paths: 'The remote version contains local data files. The update is blocked.',
    mission_active: 'Finish the current mission before updating.', busy: 'An update is already running.',
    no_update: 'Prosper is already up to date.', install_failed: 'Installation failed. The current version has been kept.',
    build_failed: 'The interface build failed. The current version has been kept.',
    restart_failed: 'Restart failed. The previous version was restored.',
    rollback_source_failed: 'Recovery needs help: files were changed during the update.',
    retry: 'Try again', version: 'Version',
  },
};
const ACTIVE = new Set(['queued', 'checking', 'preparing', 'installing', 'building', 'applying', 'restarting']);
const PENDING = 'prosper:update-job';

export function createUpdateUI({ root = document.body, getLang = () => document.documentElement.lang || 'fr', endpoint = '/api/update', showCurrent = false } = {}) {
  const panel = document.createElement('aside');
  panel.className = 'prosper-update-notice';
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  panel.style.cssText = 'padding:12px 15px;background:#201b2c;color:#f4efff;border:1px solid #6b5a87;border-radius:10px;box-shadow:0 8px 24px #0005;font:13px/1.5 system-ui,sans-serif;z-index:150;max-width:460px';
  if (root === document.body) panel.style.cssText += ';position:fixed;bottom:18px;left:18px;right:18px';
  const message = document.createElement('div'), detail = document.createElement('small'), actions = document.createElement('div');
  detail.style.cssText = 'display:block;opacity:.7;margin-top:3px';
  actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';
  const update = document.createElement('button'), check = document.createElement('button'), later = document.createElement('button');
  for (const button of [update, check, later]) {
    button.type = 'button';
    button.style.cssText = 'border:1px solid #7c6a99;border-radius:6px;padding:6px 11px;background:#342b45;color:inherit;cursor:pointer;font:inherit';
    actions.append(button);
  }
  update.style.background = '#a26239';
  panel.append(message, detail, actions);
  root.append(panel);
  let opened = false;
  let state = null, error = null, waiting = false, dismissed = null, dismissedJob = null, timer = null, destroyed = false, inflight = false;
  const lang = () => Object.hasOwn(TEXT, getLang()) ? getLang() : 'fr';
  const label = (key) => TEXT[lang()][key] ?? TEXT[lang()].failed;
  const pending = () => { try { return sessionStorage.getItem(PENDING); } catch { return null; } };
  const savePending = (id) => { try { id ? sessionStorage.setItem(PENDING, id) : sessionStorage.removeItem(PENDING); } catch {} };

  function render() {
    const active = waiting || ACTIVE.has(state?.job?.phase);
    const failure = error ?? (state?.job?.phase === 'error' && state.job.id !== dismissedJob ? state.job.error : null);
    const visible = active || failure || state?.available && dismissed !== state.remoteHead || showCurrent || opened;
    panel.hidden = !visible;
    if (!visible) return;
    const key = active ? (state?.job?.phase ?? 'restarting') : failure ?? (state?.available ? 'available' : state?.reason ?? 'current');
    message.textContent = label(key);
    update.textContent = label(failure ? 'retry' : 'update');
    check.textContent = label('check');
    later.textContent = label('later');
    update.hidden = active || !(state?.canUpdate || failure && state?.eligible);
    check.hidden = active;
    later.hidden = active;
    const version = state?.localHead ? `${label('version')} ${state.localHead.slice(0, 7)}` : '';
    let date = '';
    if (state?.checkedAt) date = `${label('checked')} : ${new Date(state.checkedAt).toLocaleString(lang())}`;
    detail.textContent = [version, date].filter(Boolean).join(' · ');
  }

  async function refresh(force = false) {
    if (destroyed || inflight) return;
    inflight = true;
    try {
      const response = await fetch(`${endpoint}${force ? '?force=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('network');
      state = await response.json();
      error = null;
      waiting = ACTIVE.has(state.job?.phase);
      if (pending() && state.job?.id === pending() && state.job.phase === 'complete') {
        savePending(null);
        location.reload();
        return;
      }
      if (state.job?.phase === 'error') savePending(null);
    } catch {
      if (pending()) waiting = true;
      else if (force) error = 'network';
    } finally { inflight = false; render(); schedule(); }
  }
  function schedule() {
    clearTimeout(timer);
    if (!destroyed) timer = setTimeout(() => refresh(), waiting || pending() ? 1500 : 60000);
  }
  update.addEventListener('click', async () => {
    update.disabled = true;
    error = null;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code ?? body.error ?? 'update_failed');
      const job = body.job ?? body;
      savePending(job.id);
      state = { ...state, job };
      waiting = true;
    } catch (failure) { error = failure.message; }
    finally { update.disabled = false; render(); schedule(); }
  });
  check.addEventListener('click', () => { dismissed = null; dismissedJob = null; refresh(true); });
  later.addEventListener('click', () => { opened=false; dismissed = state?.remoteHead; dismissedJob = state?.job?.id; error = null; panel.hidden = true; });
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  const onVisibility = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', onVisibility);
  refresh();
  return { refresh, render, open(){opened=true;refresh(true);render();}, destroy() { destroyed = true; clearTimeout(timer); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); panel.remove(); } };
}

export const mountUpdateNotice = createUpdateUI;
