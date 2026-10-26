import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Conservative public-unicast policy based on the IANA special-purpose registries:
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
const IPV4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const ipv4Number = (address) => address.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n);
const inBlock = (address, network, bits, width) => address >> BigInt(width - bits) === network >> BigInt(width - bits);
const ipv4Blocks = IPV4_BLOCKS.map(([address, bits]) => [ipv4Number(address), bits]);

function ipv6Number(address) {
  let normalised = address.toLowerCase();
  if (normalised.includes('.')) {
    const colon = normalised.lastIndexOf(':');
    const v4 = ipv4Number(normalised.slice(colon + 1));
    normalised = normalised.slice(0, colon + 1) + (v4 >> 16n).toString(16) + ':' + (v4 & 0xffffn).toString(16);
  }
  const [left, right] = normalised.split('::');
  const a = left ? left.split(':') : [];
  const b = right ? right.split(':') : [];
  const groups = normalised.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return groups.reduce((n, part) => (n << 16n) | BigInt('0x' + part), 0n);
}
const ipv6Blocks = [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]
  .map(([address, bits]) => [ipv6Number(address), bits]);

export function isPublicAddress(rawAddress) {
  const address = String(rawAddress ?? '').replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) {
    const number = ipv4Number(address);
    return !ipv4Blocks.some(([network, bits]) => inBlock(number, network, bits, 32));
  }
  if (family !== 6 || address.includes('%')) return false;
  const number = ipv6Number(address);
  // Mapped IPv4 must be classified using its real IPv4 destination, not its IPv6 spelling.
  if (number >> 32n === 0xffffn) {
    const v4 = [24n, 16n, 8n, 0n].map((shift) => Number((number >> shift) & 255n)).join('.');
    return isPublicAddress(v4);
  }
  // Native globally routable unicast only; local, link-local, multicast, translation,
  // unspecified and transition ranges are not acceptable business websites.
  return number >> 125n === 1n && !ipv6Blocks.some(([network, bits]) => inBlock(number, network, bits, 128));
}

export const publicResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

// Le DNS et les implémentations injectées ne respectent pas forcément AbortSignal.
// Leurs résultats tardifs restent observés, mais ne retiennent pas le lecteur.
export function attendreAvecSignal(operation, signal, onLateValue = () => {}) {
  signal?.throwIfAborted();
  const promise = Promise.resolve().then(operation);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let done = false;
    const abort = () => { if (done) return; done = true; signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('Lecture annulée')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => { if (done) { try { onLateValue(value); } catch {} return; } done = true; signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { if (done) return; done = true; signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export async function assertPublicUrl(input, { resolver = publicResolver, signal } = {}) {
  signal?.throwIfAborted();
  let url;
  try { url = new URL(input); } catch { throw new Error('Adresse de site invalide'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Seuls les sites HTTP(S) publics sont autorisés');
  if (url.username || url.password) throw new Error('Les adresses avec identifiants sont interdites');
  url.hash = '';
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || /(^|\.)(localhost|local|internal|intranet|lan|home|home\.arpa)$/.test(hostname)) {
    throw new Error('Les adresses locales sont interdites');
  }
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Les adresses réseau non publiques sont interdites');
    return url;
  }
  if (!hostname.includes('.')) throw new Error('Les noms de réseau locaux sont interdits');
  let answers;
  try { answers = await attendreAvecSignal(() => resolver(hostname), signal); } catch { signal?.throwIfAborted(); throw new Error('Impossible de vérifier l’adresse publique du site'); }
  if (!Array.isArray(answers) || !answers.length || !answers.every((answer) => isPublicAddress(typeof answer === 'string' ? answer : answer?.address))) {
    throw new Error('Le domaine doit uniquement résoudre vers des adresses publiques');
  }
  return url;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/** No automatic redirect may issue a request before its next destination is checked. */
export async function fetchPublic(input, { resolver = publicResolver, fetchImpl = globalThis.fetch, ...requestOptions } = {}) {
  let next = input;
  for (let redirects = 0; ; redirects++) {
    requestOptions.signal?.throwIfAborted();
    const url = await assertPublicUrl(next, { resolver, signal: requestOptions.signal });
    requestOptions.signal?.throwIfAborted();
    const response = await attendreAvecSignal(() => fetchImpl(url.href, { ...requestOptions, redirect: 'manual' }), requestOptions.signal,
      (late) => { late.body?.cancel().catch(() => {}); });
    // A non-conforming/custom fetch must never silently bypass the manual redirect policy.
    if (response.redirected) {
      response.body?.cancel().catch(() => {});
      throw new Error('Redirection automatique non autorisée');
    }
    if (!REDIRECTS.has(response.status)) return { response, finalUrl: url.href };
    const location = response.headers.get('location');
    response.body?.cancel().catch(() => {});
    if (!location) throw new Error('Redirection sans destination');
    if (redirects >= MAX_REDIRECTS) throw new Error('Trop de redirections (maximum 5)');
    try { next = new URL(location, url).href; } catch { throw new Error('Destination de redirection invalide'); }
  }
}

// DNS is checked before each request but global fetch resolves again when connecting.
// This blocks static local destinations and redirect pivots; it does not pin the verified
// address to the socket, so DNS rebinding remains a documented residual limitation.
