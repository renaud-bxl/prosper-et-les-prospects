// Palette et comportement inspirés du bureau Oscar : matériaux clairs, nuit bleutée,
// sans filtre sur les illustrations ni rechargement de la mission.
import { getLang } from './i18n.js';

export const THEME_STORAGE = 'prosper.theme';
export const THEME_MODES = Object.freeze(['auto', 'light', 'dark']);
const labels = {
  fr: { label: 'Apparence', auto: 'Automatique', light: 'Clair', dark: 'Nuit' },
  nl: { label: 'Weergave', auto: 'Automatisch', light: 'Licht', dark: 'Nacht' },
  en: { label: 'Appearance', auto: 'Automatic', light: 'Light', dark: 'Night' },
};

export function resolveTheme(mode = 'auto', date = new Date()) {
  if (mode === 'light' || mode === 'dark') return mode;
  return date.getHours() >= 20 || date.getHours() < 8 ? 'dark' : 'light';
}

/** onChange({mode, theme}) est appelé immédiatement puis à chaque changement effectif. */
export function initTheme({ select, onChange } = {}) {
  let storage;
  try { storage = globalThis.localStorage; } catch {}
  let mode = 'auto';
  try { const saved = storage?.getItem(THEME_STORAGE); if (THEME_MODES.includes(saved)) mode = saved; } catch {}
  let theme = null;
  let destroyed = false;
  let created = false;
  if (!select) {
    select = document.createElement('select');
    select.id = 'theme-mode';
    select.className = 'theme-select';
    document.querySelector('.app-controls')?.append(select);
    created = true;
  }
  const render = () => {
    const text = labels[getLang()] ?? labels.fr;
    select.setAttribute('aria-label', text.label);
    select.setAttribute('title', text.label);
    // Les trois options restent de simples contrôles natifs, utilisables au clavier.
    select.replaceChildren(...THEME_MODES.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value === 'light' ? '☀ ' : value === 'dark' ? '☾ ' : ''}${text[value]}`;
      return option;
    }));
    select.value = mode;
  };
  const apply = () => {
    if (destroyed) return theme;
    const next = resolveTheme(mode);
    const changed = next !== theme || document.documentElement.dataset.themeMode !== mode;
    theme = next;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101a24' : '#f6f7f8');
    select.value = mode;
    if (changed) {
      const detail = { mode, theme };
      onChange?.(detail);
      document.dispatchEvent(new CustomEvent('prosper-theme', { detail }));
    }
    return theme;
  };
  const setMode = (next) => {
    if (!THEME_MODES.includes(next)) return theme;
    mode = next;
    try { storage?.setItem(THEME_STORAGE, mode); } catch {}
    return apply();
  };
  const change = (event) => setMode(event.target.value);
  const stored = (event) => {
    if (event.key !== THEME_STORAGE) return;
    mode = THEME_MODES.includes(event.newValue) ? event.newValue : 'auto';
    apply();
  };
  select.addEventListener('change', change);
  document.addEventListener('visibilitychange', apply);
  document.addEventListener('prosper-language', render);
  window.addEventListener('storage', stored);
  const timer = setInterval(apply, 60000);
  render();
  apply();
  return {
    get mode() { return mode; },
    get theme() { return theme; },
    setMode,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      select.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', apply);
      document.removeEventListener('prosper-language', render);
      window.removeEventListener('storage', stored);
      if (created) select.remove();
    },
  };
}
