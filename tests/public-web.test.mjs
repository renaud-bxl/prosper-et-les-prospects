import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, assertPublicUrl, fetchPublic } from '../server/agents/public-web.mjs';
import { lire } from '../server/agents/lecteur.mjs';
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const html = (body) => new Response(body, { headers: { 'content-type': 'text/html' } });
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });

test('non-public IPv4/IPv6 and mapped private IPv4 are rejected', () => {
  for (const ip of ['0.0.0.0', '0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.254', '127.0.0.1',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.1.1',
    '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255',
    '240.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0',
    'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:192.168.1.1', '::ffff:7f00:1',
    '::ffff:a9fe:a9fe', '::127.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2001::1', '2002:7f00:1::1',
    '3fff::1', 'not-an-ip', '']) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.128.0.1',
    '2001:4860:4860::8888', '2606:4700:4700::1111', '2a00:1450:4009:80b::200e', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ip), true, ip);
});

test('unsafe schemes, userinfo, local hostnames and noncanonical loopback fail before DNS', async () => {
  let calls = 0;
  const resolver = async () => { calls++; return publicDns(); };
  for (const url of ['file:///etc/passwd', 'ftp://commerce.be/file', 'data:text/html,secret', 'not a URL',
    'https://user:pass@commerce.be/', 'https://user@commerce.be/', 'http://localhost/', 'http://localhost./',
    'http://sub.localhost/', 'http://printer/', 'http://service.local/', 'http://intranet.lan/', 'http://router.home.arpa/',
    'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/']) {
    await assert.rejects(assertPublicUrl(url, { resolver }), undefined, url);
  }
  assert.equal(calls, 0);
});

test('every DNS answer must be public; empty and failed lookups fail closed', async () => {
  const lookups = [];
  const resolver = async (host) => { lookups.push(host); return [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700::1111', family: 6 }]; };
  assert.equal((await assertPublicUrl('https://commerce.be/contact#fragment', { resolver })).href, 'https://commerce.be/contact');
  assert.deepEqual(lookups, ['commerce.be']);
  for (const answers of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: 'fd00::1', family: 6 }], ['::ffff:192.168.1.1'], [{}]]) {
    await assert.rejects(assertPublicUrl('https://commerce.be/', { resolver: async () => answers }));
  }
  await assert.rejects(assertPublicUrl('https://commerce.be/', { resolver: async () => { throw new Error('DNS unavailable'); } }));
});

test('manual redirects recheck each destination and resolve relative locations', async () => {
  const calls = [], lookups = [];
  const resolver = async (host) => { lookups.push(host); return publicDns(); };
  const fetchImpl = async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'manual');
    if (url === 'http://commerce.be/') return redirect('https://www.commerce.be/home', 301);
    if (url === 'https://www.commerce.be/home') return redirect('/contact', 307);
    return html('public');
  };
  const result = await fetchPublic('http://commerce.be/', { resolver, fetchImpl });
  assert.equal(result.finalUrl, 'https://www.commerce.be/contact');
  assert.deepEqual(calls, ['http://commerce.be/', 'https://www.commerce.be/home', 'https://www.commerce.be/contact']);
  assert.deepEqual(lookups, ['commerce.be', 'www.commerce.be', 'www.commerce.be']);
});

test('redirect pivots to private literals, private DNS, credentials or other protocols never fetch their destination', async () => {
  for (const location of ['http://127.0.0.1:8080/secret', 'http://[::ffff:192.168.0.1]/', 'http://localhost/',
    'http://169.254.169.254/', 'https://user:pass@public.be/', 'file:///etc/passwd', 'https://internal.be/secret']) {
    const calls = [];
    const resolver = async (host) => host === 'internal.be' ? [{ address: '10.10.0.1', family: 4 }] : publicDns();
    await assert.rejects(fetchPublic('https://commerce.be/', { resolver, fetchImpl: async (url) => { calls.push(url); return redirect(location); } }), undefined, location);
    assert.deepEqual(calls, ['https://commerce.be/'], location);
  }
  let lookups = 0, requests = 0;
  await assert.rejects(fetchPublic('https://commerce.be/', {
    resolver: async () => ++lookups === 1 ? publicDns() : [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => { requests++; return redirect('/same-host-next-page'); },
  }));
  assert.equal(lookups, 2, 'same-host redirects must also resolve again');
  assert.equal(requests, 1, 'changed private DNS must be rejected before requesting the next page');
});

test('five redirects are permitted, a sixth fails; automatic redirect bypasses are rejected', async () => {
  let calls = 0;
  const allowed = await fetchPublic('https://commerce.be/0', { resolver: publicDns, fetchImpl: async (url) => {
    calls++; const n = +new URL(url).pathname.slice(1); return n < 5 ? redirect('/' + (n + 1)) : html('done');
  } });
  assert.equal(allowed.finalUrl, 'https://commerce.be/5'); assert.equal(calls, 6);
  calls = 0;
  await assert.rejects(fetchPublic('https://commerce.be/', { resolver: publicDns, fetchImpl: async () => { calls++; return redirect('/again'); } }), /maximum 5/);
  assert.equal(calls, 6);
  await assert.rejects(fetchPublic('https://commerce.be/', { resolver: publicDns, fetchImpl: async () => {
    const response = html('must not be read'); Object.defineProperty(response, 'redirected', { value: true }); return response;
  } }), /automatique/);
});

test('reader candidates must share the full origin and a private redirect contributes no content', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'manual'); calls.push(url);
    if (url === 'https://commerce.be/') return html('<html lang="fr"><p>Accueil public.</p><a href="/contact">Contact</a><a href="http://commerce.be/contact">Autre protocole</a><a href="https://commerce.be:8443/contact">Autre port</a><a href="https://other.be/contact">Externe</a><a href="https://user:pass@commerce.be/contact">Identifiants</a></html>');
    if (url === 'https://commerce.be/contact') return redirect('http://192.168.0.1/private');
    throw new Error('Unexpected network request: ' + url);
  };
  const result = await lire({ website: 'https://commerce.be/', pays: 'BE' }, { resolver: publicDns, fetchImpl });
  assert.equal(result.ok, true); assert.match(result.excerpt, /Accueil public/);
  assert.deepEqual(calls, ['https://commerce.be/', 'https://commerce.be/contact']);
  assert.deepEqual(result.signals.pages_lues, ['/']);
});

test('unsafe initial sites return no excerpt and make no HTTP request', async () => {
  let calls = 0;
  for (const website of ['http://127.0.0.1/', 'http://[::1]/', 'file:///etc/passwd', 'https://internal.be/', 'not a URL']) {
    const result = await lire({ website }, { resolver: async () => [{ address: '10.0.0.1', family: 4 }], fetchImpl: async () => { calls++; throw new Error('Must not fetch'); } });
    assert.equal(result.ok, false); assert.equal(result.excerpt, ''); assert.deepEqual(result.emails, []);
  }
  assert.equal(calls, 0);
});
