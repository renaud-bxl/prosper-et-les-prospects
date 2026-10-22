// Le lecteur : ouvre le site de chaque commerce (accueil + pages contact, mentions, réservation),
// relève l'adresse de contact affichée et les signaux utiles (réservation en ligne, discussion, WhatsApp…).

import { isIP } from 'node:net';
import { fetchPublic, isPublicAddress } from './public-web.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAX_BYTES = 1_500_000;

const BOOKING = [
  ['TheFork', /thefork\.|lafourchette\./i], ['Zenchef', /zenchef/i], ['SevenRooms', /sevenrooms/i],
  ['OpenTable', /opentable\./i], ['Resy', /resy\.com/i], ['Guestonline', /guestonline/i], ['Quandoo', /quandoo/i],
  ['Formitable', /formitable/i], ['Tablebooker', /tablebooker/i], ['Resengo', /resengo/i], ['Bookingshake', /bookingshake/i],
  ['Resamania', /resamania/i], ['Deciplus', /deciplus/i], ['bsport', /bsport\.io/i], ['Mindbody', /mindbody/i],
  ['Glofox', /glofox/i], ['Heitz', /heitzsystem/i], ['Hapik', /hapik/i], ['Planity', /planity\./i], ['Treatwell', /treatwell\./i], ['Calendly', /calendly\.com/i], ['Doctolib', /doctolib\./i],
];
const CHAT = [
  ['Crisp', /crisp\.chat/i], ['Intercom', /intercom(cdn)?\.(io|com)/i], ['Tidio', /tidio(chat)?\./i], ['tawk.to', /tawk\.to/i],
  ['Zendesk', /zdassets|zendesk/i], ['HubSpot', /hs-scripts|hubspot/i], ['Messenger', /customerchat|m\.me\//i],
];
const BUILDERS = [
  ['Wix', /wixstatic|wix\.com|_wixCIDX/i], ['WordPress', /wp-content|wp-includes/i], ['Squarespace', /squarespace/i],
  ['Shopify', /cdn\.shopify|myshopify/i], ['Webflow', /webflow/i], ['Jimdo', /jimdo/i], ['Site Google', /sites\.google/i],
];

const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|orange|wanadoo|free|sfr|neuf|laposte|bbox|aol|protonmail|proton)\./i;
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const EMAIL_JUNK = /\.(png|jpe?g|gif|webp|svg|avif)$|@(sentry|wixpress|example|domain|email|sentry-next)\.|^(noreply|no-reply|nepasrepondre|u0|user|name|nom|votre|your)@|@2x/i;

async function getHtml(url, { resolver, fetchImpl } = {}) {
  const { response: res, finalUrl } = await fetchPublic(url, {
    resolver, fetchImpl,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7' },
    signal: AbortSignal.timeout(10000),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !/html/i.test(type)) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
  }
  return { html: Buffer.concat(chunks).toString('utf8'), finalUrl };
}

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;|&#8217;/g, '’').replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ccedil;/g, 'ç').replace(/&ocirc;/g, 'ô').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { out.push({ url: new URL(m[1].trim(), base).href, text: m[2].replace(/<[^>]+>/g, ' ').trim().toLowerCase() }); } catch {}
  }
  return out;
}

// Décode les entités HTML (&#064; &#x40; …) et les adresses protégées par Cloudflare (data-cfemail).
function decodeEntities(html) {
  const point = (full, number) => number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : full;
  return html
    .replace(/&#(\d+);/g, (full, n) => point(full, +n))
    .replace(/&#x([0-9a-f]+);/gi, (full, n) => point(full, parseInt(n, 16)))
    .replace(/&commat;/gi, '@').replace(/&period;/gi, '.');
}

function cloudflareEmails(html) {
  const out = [];
  for (const m of html.matchAll(/(?:data-cfemail=["']|email-protection#)([0-9a-f]{8,})/gi)) {
    const hex = m[1];
    const key = parseInt(hex.slice(0, 2), 16);
    let e = '';
    for (let i = 2; i < hex.length; i += 2) e += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    if (e.includes('@')) out.push(e.toLowerCase());
  }
  return out;
}

export function findEmails(rawHtml, siteHost) {
  const found = new Set(cloudflareEmails(rawHtml));
  const html = decodeEntities(rawHtml);
  const deob = html.replace(/\s*(\[at\]|\(at\)|\s+arobase\s+)\s*/gi, '@').replace(/\s*(\[dot\]|\(dot\))\s*/gi, '.');
  for (const m of deob.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    try { found.add(decodeURIComponent(m[1]).toLowerCase()); } catch { /* lien mal encodé */ }
  }
  for (const m of visibleText(deob).matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  const host = siteHost.replace(/^www\./, '');
  const root = host.split('.').slice(-2).join('.');
  return [...found]
    .filter((e) => !EMAIL_JUNK.test(e))
    // On garde l'adresse du commerce : son propre domaine, ou une messagerie grand public (le gérant).
    // Les adresses d'agences web, de plateformes ou de partenaires affichées sur le site sont écartées.
    .filter((e) => e.endsWith('@' + host) || e.split('@')[1] === root || e.split('@')[1].endsWith('.' + root) || FREEMAIL.test(e.split('@')[1]))
    // Les adresses du site lui-même d'abord, puis contact@ / reservation@ / bonjour@.
    .sort((a, b) => rankEmail(b, host) - rankEmail(a, host));
}

// Numéros Benelux au format international. Le pays sert à lever l'ambiguïté des numéros locaux.
const PHONE_INTERNATIONAL_RE = /(?<![\w+])(?:\+|00)(?:352|32|31)(?:[ .()\/-]*\d){6,10}(?!\d)/g;
const PHONE_LOCAL_RE = /(?<![\w+])0[1-9](?:[ .()\/-]*\d){6,8}(?!\d)/g;

export function paysDuSite(place = {}, host = '') {
  const pays = String(place.pays ?? place.country_code ?? '').toUpperCase();
  if (['BE', 'NL', 'LU'].includes(pays)) return pays;
  const tld = host.split('.').at(-1)?.toUpperCase();
  return ['BE', 'NL', 'LU'].includes(tld) ? tld : null;
}

export function normaliserTelephone(value, pays = null) {
  let raw = String(value).trim().replace(/(?:;ext=|\bext\.?|\bx)\s*\d+\s*$/i, '');
  if (!/^[+\d\s()./\-]+$/.test(raw)) return null;
  if (/^(?:\+|00)(?:31|32|352)/.test(raw)) raw = raw.replace(/\(0\)/, '');
  let digits = raw.replace(/[^\d+]/g, '').replace(/^00/, '+');
  if (!digits.startsWith('+')) {
    if (pays === 'BE' && /^0[1-9]\d{7,8}$/.test(digits)) digits = '+32' + digits.slice(1);
    else if (pays === 'NL' && /^0[1-9]\d{8}$/.test(digits)) digits = '+31' + digits.slice(1);
    else if (pays === 'LU' && /^[2-9]\d{5,8}$/.test(digits)) digits = '+352' + digits;
    else return null;
  }
  if (/^\+32(?:[1-9]\d{7}|4\d{8})$/.test(digits)) return digits;
  if (/^\+31[1-9]\d{8}$/.test(digits)) return digits;
  if (/^\+352(?:[2-9]\d{5,7}|6\d{8})$/.test(digits)) return digits;
  return null;
}

export function findPhones(rawHtml, pays = null) {
  const html = decodeEntities(rawHtml);
  const raw = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    try { raw.add(decodeURIComponent(m[1])); } catch { /* lien mal encodé */ }
  }
  const text = visibleText(html);
  for (const m of text.matchAll(PHONE_INTERNATIONAL_RE)) raw.add(m[0]);
  if (pays === 'BE' || pays === 'NL') for (const m of text.matchAll(PHONE_LOCAL_RE)) raw.add(m[0]);
  // Les numéros luxembourgeois n'ont pas de zéro initial : exige un libellé de contact
  // ou des groupes séparés pour éviter de transformer un identifiant quelconque en téléphone.
  if (pays === 'LU') {
    for (const m of text.matchAll(/(?<![\d+])(?:[2-9]\d{1,2})(?:[ .()-]+\d{2,3}){2,3}(?!\d)/g)) raw.add(m[0]);
    for (const m of text.matchAll(/(?:t[ée]l[ée]phone|t[ée]l|phone|telefon|telefoon)\s*[:.]?\s*([2-9]\d{5,8})(?!\d)/gi)) raw.add(m[1]);
  }
  const out = new Set();
  for (const r of raw) {
    const phone = normaliserTelephone(r, pays);
    if (phone) out.add(phone);
  }
  return [...out].slice(0, 3);
}

function rankEmail(e, host) {
  let s = 0;
  if (e.endsWith('@' + host)) s += 10;
  if (/^(contact|kontakt|bonjour|hello|info|infos|reservation|reservations|reserveren|boekingen|booking|resa|accueil)@/.test(e)) s += 5;
  return s;
}

function detect(html, list) {
  for (const [name, re] of list) if (re.test(html)) return name;
  return null;
}

export function langueDuSite(html) {
  // Seule une déclaration explicite de langue est retenue. Ni le pays, ni le TLD,
  // ni un sélecteur de langue ne prouvent la langue du contenu actuellement lu.
  const declaration = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const lang = declaration.match(/\slang\s*=\s*["']([^"']+)["']/i)?.[1];
  const langue = lang?.toLowerCase().split(/[-_]/)[0];
  return ['fr', 'nl', 'en'].includes(langue)
    ? { langue, langue_source: 'html[lang]' }
    : { langue: null, langue_source: null };
}

export function estPageUtile(link) {
  return /contact|kontakt|mentions|legal|impressum|privacy|reserv|reserveren|boek(en|ing)|booking|buchen|tisch|infos?-pratiques|a-propos|about|over-ons|praktisch|bereikbaarheid/i.test(link.url + ' ' + link.text);
}

export function reservationReperee(html) {
  const provider = detect(html, BOOKING);
  const texte = /r[ée]serv(ez|er)\s+(en ligne|une table|maintenant)|r[ée]servation en ligne|book\s+(?:a|your)\s+(?:table|appointment)|book\s+online|online\s+(?:reservieren|reserveren|boeken)|(?:tafel|afspraak)\s+(?:reserveren|boeken)|(?:reserveer|boek)\s+(?:een\s+)?(?:tafel|afspraak)|(?:tisch|termin)\s+(?:online\s+)?(?:reservieren|buchen)/i.test(visibleText(html));
  return provider ?? (texte ? 'oui (module ou lien repéré)' : null);
}

/** Informations explicitement publiées sur les pages déjà lues. Aucun appel réseau. */
export function informationsPubliques(pages = [], place = {}) {
  const info = { version: 1, pages: [], sites: [], adresse: [], horaires: [], emails: [], telephones: [], reseaux: [], services: [], liens: [] };
  const plain = value => typeof value === 'string' || typeof value === 'number'
    ? visibleText(decodeEntities(String(value))).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
  const attr = (raw, name) => raw.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*["\x27]([^"\x27]*)["\x27]', 'i'))?.[1] ?? '';
  const publicLink = (value, base) => {
    try { const url = new URL(decodeEntities(String(value)).replace(/&amp;/gi, '&'), base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 1500) return null;
      if (!url.hostname.includes('.') || /(^|\.)(localhost|local|internal|lan)$/.test(url.hostname)) return null;
      if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  };
  const add = (key, value, source) => {
    const text = plain(value);
    if (text && info[key].length < 12 && !info[key].some(item => item.value === text)) info[key].push({ value: text, source });
  };
  const addLink = (key, value, label, source) => {
    const url = publicLink(value, source);
    if (url && info[key].length < 20 && !info[key].some(item => item.url === url)) info[key].push({ label: plain(label) || new URL(url).hostname, url, source });
  };
  const social = url => {
    try { const host = new URL(url).hostname.replace(/^www\./, '');
      return [['Instagram', /(^|\.)instagram\.com$/], ['Facebook', /(^|\.)facebook\.com$/], ['LinkedIn', /(^|\.)linkedin\.com$/],
        ['TikTok', /(^|\.)tiktok\.com$/], ['YouTube', /(^|\.)(youtube\.com|youtu\.be)$/], ['X / Twitter', /(^|\.)(twitter\.com|x\.com)$/],
        ['WhatsApp', /(^|\.)(wa\.me|whatsapp\.com)$/]].find(([, re]) => re.test(host))?.[0] ?? null;
    } catch { return null; }
  };
  const business = type => /^(Organization|LocalBusiness|Restaurant|CafeOrCoffeeShop|Bakery|BarOrPub|Hotel|HairSalon|BeautySalon|ExerciseGym|SportsActivityLocation|Dentist|ProfessionalService|AutoRepair)$|(?:Business|Store)$/.test(type);
  for (const page of pages.slice(0, 4)) {
    const source = publicLink(page.finalUrl ?? page.url);
    if (!source || typeof page.html !== 'string') continue;
    const html = page.html.slice(0, MAX_BYTES), host = new URL(source).hostname, country = paysDuSite(place, host);
    info.pages.push({ url: source, titre: plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 120) });
    add('sites', info.pages[0].url, source);
    const email = value => { for (const address of findEmails('mailto:' + String(value ?? '').replace(/^mailto:/i, ''), host)) add('emails', address, source); };
    const phone = value => { try { const parsed = normaliserTelephone(decodeURIComponent(String(value ?? '').replace(/^tel:/i, '')), country); if (parsed) add('telephones', parsed, source); } catch {} };
    for (const address of findEmails(html, host)) add('emails', address, source);
    for (const number of findPhones(html, country)) add('telephones', number, source);
    for (const link of links(html, source).slice(0, 1000)) {
      const url = publicLink(link.url, source), label = url && social(url);
      if (label) addLink('reseaux', url, label, source);
      if (estPageUtile(link) || /services?|prestat|diensten|aanbod|tarif|prix|prijzen|pricing|horaires|opening|heures|menu|menukaart|livraison|delivery|afhalen/i.test(link.url + ' ' + link.text)) addLink('liens', link.url, link.text, source);
    }
    for (const match of html.matchAll(/<address\b[^>]*>([\s\S]*?)<\/address>/gi)) add('adresse', match[1], source);
    // Structured business data only; employee/person records and arbitrary scripts are ignored.
    let budget = 300;
    const walk = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 8 || budget-- <= 0) return;
      if (Array.isArray(node)) { for (const item of node.slice(0, 100)) walk(item, depth + 1); return; }
      const types = [].concat(node['@type'] ?? []).filter(type => typeof type === 'string').map(type => type.split(/[\/#]/).at(-1));
      const isBusiness = types.some(business) && !types.includes('Person');
      if (isBusiness) {
        const declared = typeof node.url === 'string' ? publicLink(node.url, source) : null;
        if (!declared || new URL(declared).hostname.replace(/^www\./, '') === host.replace(/^www\./, '')) {
          for (const value of [].concat(node.email ?? [])) email(value);
          for (const value of [].concat(node.telephone ?? [])) phone(value);
          for (const contact of [].concat(node.contactPoint ?? [])) if (contact && typeof contact === 'object') {
            for (const value of [].concat(contact.email ?? [])) email(value);
            for (const value of [].concat(contact.telephone ?? [])) phone(value);
          }
          for (const address of [].concat(node.address ?? [])) add('adresse', typeof address === 'string' ? address
            : address && typeof address === 'object' ? [address.streetAddress, address.postalCode, address.addressLocality, address.addressRegion, typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry].map(plain).filter(Boolean).join(', ') : '', source);
          for (const hours of [].concat(node.openingHours ?? [])) add('horaires', hours, source);
          for (const hours of [].concat(node.openingHoursSpecification ?? [])) if (hours && typeof hours === 'object') {
            const days = [].concat(hours.dayOfWeek ?? []).filter(value => typeof value === 'string').map(value => value.split('/').at(-1)).join(', ');
            if (days && hours.opens && hours.closes) add('horaires', `${days} ${plain(hours.opens)}–${plain(hours.closes)}`, source);
          }
          for (const url of [].concat(node.sameAs ?? [])) { const label = social(url); if (label) addLink('reseaux', url, label, source); }
          for (const service of [].concat(node.availableService ?? [], node.hasOfferCatalog?.itemListElement ?? [], node.makesOffer ?? [])) add('services', typeof service === 'string' ? service : service?.itemOffered?.name ?? service?.name, source);
          for (const field of ['menu', 'hasMenu', 'acceptsReservations']) if (typeof node[field] === 'string') addLink('liens', node[field], field, source);
        }
      }
      for (const [key, value] of Object.entries(node)) if (key !== 'employee' && key !== 'employees' && key !== 'founder' && value && typeof value === 'object') walk(value, depth + 1);
    };
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (attr(match[1], 'type').toLowerCase() !== 'application/ld+json' || match[2].length > 120000) continue;
      try { walk(JSON.parse(match[2])); } catch { /* broken structured data does not invalidate the page */ }
    }
    // Microdata: retain public business properties, excluding nested Person scopes.
    const microHtml = html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    const lowerHtml = microHtml.toLowerCase();
    const stack = []; let tokens = 0;
    for (const match of microHtml.matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>/gi)) {
      if (++tokens > 10000) break;
      const tag = match[1].toLowerCase();
      if (match[0][1] === '/') { const index = stack.findLastIndex(item => item.tag === tag); if (index >= 0) stack.length = index; continue; }
      const type = attr(match[2], 'itemtype').split(/[\/#]/).at(-1), inherited = stack.at(-1)?.context ?? null;
      const context = type === 'Person' ? 'person' : business(type) ? 'business' : inherited;
      const properties = attr(match[2], 'itemprop').split(/\s+/);
      if (context !== 'person') {
        const end = lowerHtml.indexOf('</' + tag, match.index + match[0].length);
        const text = end >= 0 ? microHtml.slice(match.index + match[0].length, Math.min(end, match.index + match[0].length + 2000)) : '';
        const value = attr(match[2], 'content') || attr(match[2], 'href') || attr(match[2], 'datetime') || text;
        if (properties.includes('email')) email(plain(value));
        if (properties.includes('telephone')) phone(plain(value));
        if (properties.includes('address') || type === 'PostalAddress') add('adresse', text || value, source);
        if (properties.includes('openingHours')) add('horaires', value, source);
        if (properties.includes('availableService')) add('services', value, source);
      }
      if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !/\/\s*>$/.test(match[0])) stack.push({ tag, context });
    }
  }
  return info;
}

/** Lit un site. `onStep(texte)` raconte ce que le lecteur fait, page par page. */
export async function lire(place, { onStep, resolver, fetchImpl } = {}) {
  if (!place.website) return { ok: false, raison: 'pas de site', signals: { site: false }, emails: [], excerpt: '' };
  let start;
  try { start = new URL(place.website); } catch {
    return { ok: false, raison: 'adresse de site invalide', signals: { site: false }, emails: [], excerpt: '' };
  }
  // Un « site » qui est une page Facebook ou Instagram n'est pas un site.
  if (/facebook\.com|instagram\.com|linktr\.ee|tripadvisor\./i.test(start.host)) {
    return { ok: false, raison: 'pas de vrai site (réseau social)', signals: { site: false, social_only: start.host }, emails: [], excerpt: '' };
  }
  onStep?.(`J'ouvre ${start.host}`);
  let home;
  try { home = await getHtml(start.href, { resolver, fetchImpl }); } catch (e) {
    return { ok: false, raison: `site injoignable (${e.message})`, signals: { site: false, injoignable: true }, emails: [], excerpt: '' };
  }
  const pages = [{ url: home.finalUrl, html: home.html }];
  const origin = new URL(home.finalUrl).origin;
  const host = new URL(home.finalUrl).host;
  const candidates = links(home.html, home.finalUrl)
    .filter((l) => {
      const target = new URL(l.url);
      return target.origin === origin && !target.username && !target.password && !/\.(pdf|jpe?g|png)$/i.test(target.pathname);
    })
    .filter(estPageUtile)
    // Les pages contact et mentions légales d'abord : c'est là que l'adresse est affichée.
    .sort((a, b) => /contact|kontakt|mentions|legal|impressum/i.test(b.url + b.text) - /contact|kontakt|mentions|legal|impressum/i.test(a.url + a.text));
  // Aucun lien trouvé (menu en JavaScript) : on essaie les adresses habituelles.
  const langue = langueDuSite(home.html).langue;
  const fallbackPaths = langue === 'nl' ? ['/contact', '/contactgegevens', '/over-ons']
    : paysDuSite(place, host) === 'LU' ? ['/contact', '/mentions-legales', '/impressum']
      : ['/contact', '/mentions-legales', '/impressum'];
  if (!candidates.length) for (const path of fallbackPaths) candidates.push({ url: new URL(path, home.finalUrl).href, text: '' });
  const seen = new Set([home.finalUrl]);
  for (const l of candidates) {
    if (pages.length >= 4) break;
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    onStep?.(`Je lis ${new URL(l.url).pathname}`);
    try { const page = await getHtml(l.url, { resolver, fetchImpl }); pages.push({ url: page.finalUrl, html: page.html }); } catch {}
  }

  const all = pages.map((p) => p.html).join('\n');
  const text = visibleText(home.html);
  const years = [...all.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/gi)].map((m) => +m[1]);
  const signals = {
    site: true,
    https: home.finalUrl.startsWith('https:'),
    mobile: /<meta[^>]+name=["']viewport["']/i.test(home.html),
    reservation_en_ligne: reservationReperee(all),
    discussion: detect(all, CHAT),
    whatsapp: /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(all),
    instagram: (all.match(/instagram\.com\/([a-z0-9_.]{2,30})/i) ?? [])[1] ?? null,
    menu_pdf: /href=["'][^"']+\.pdf["']/i.test(all) && /carte|menu/i.test(all),
    outil: detect(all, BUILDERS),
    annee: years.length ? Math.max(...years) : null,
    titre: (home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    pages_lues: pages.map((p) => new URL(p.url).pathname),
    ...langueDuSite(home.html),
  };
  const info = informationsPubliques(pages, place);
  signals.info = info;
  const emails = [...new Set([...findEmails(all, host), ...info.emails.map(item => item.value)])];
  // L'adresse renseignée sur la carte (OpenStreetMap) compte aussi, si c'est bien celle du commerce.
  const osm = place.email_osm?.toLowerCase().trim();
  if (osm && !emails.includes(osm) && findEmails(`mailto:${osm}`, host).length) emails.push(osm);
  // La page où l'adresse retenue est affichée (pour la montrer dans la fiche).
  let email_source = null;
  if (emails[0]) {
    const page = pages.find((p) => findEmails(p.html, host).includes(emails[0]));
    const structured = info.emails.find(item => item.value === emails[0]);
    email_source = page ? new URL(page.url).pathname : structured ? new URL(structured.source).pathname : emails[0] === osm ? 'OpenStreetMap' : null;
  }
  const telephones = [...new Set([...findPhones(all, paysDuSite(place, host)), ...info.telephones.map(item => item.value)])].slice(0, 3);
  onStep?.(emails.length ? `Adresse trouvée : ${emails[0]}` : 'Aucune adresse de contact affichée');
  if (telephones.length) onStep?.(`Téléphone trouvé : ${telephones[0]}`);
  return { ok: true, signals, emails, email_source, telephones, excerpt: text.slice(0, 1500) };
}

/** Le score : est-ce un bon client pour l'offre ? Chaque point est expliqué (pas de boîte noire). */
export function noter(place, lecture) {
  const s = lecture.signals ?? {};
  const raisons = [];
  let score = 30;
  const add = (pts, texte) => { score += pts; raisons.push({ pts, texte }); };
  if (!s.site) add(-30, 'pas de site lisible');
  if (s.site && !s.reservation_en_ligne) add(25, 'pas de réservation en ligne');
  if (s.reservation_en_ligne) add(-15, `réserve déjà en ligne (${s.reservation_en_ligne})`);
  if (s.site && !s.discussion) add(10, 'personne pour répondre sur le site');
  if (s.site && !s.whatsapp) add(5, 'pas de WhatsApp');
  if (place.horaires && /(2[1-4]|00):\d{2}|24\/7/.test(place.horaires)) add(10, 'ouvert tard : des demandes à toute heure');
  if ((place.rating ?? 0) >= 4.3) add(10, `bien noté (${String(place.rating).replace('.', ',')} ★)`);
  if ((place.reviews ?? 0) >= 150) add(10, `beaucoup de clients (${place.reviews} avis)`);
  if ((place.reviews ?? 0) >= 600) add(5, 'très fréquenté');
  if (s.site && !s.mobile) add(5, 'site pas fait pour le téléphone');
  if (s.annee && s.annee < 2023) add(5, `site pas mis à jour depuis ${s.annee}`);
  if (!lecture.emails?.length) add(-20, 'aucune adresse de contact');
  return { score: Math.max(0, Math.min(100, score)), raisons };
}

