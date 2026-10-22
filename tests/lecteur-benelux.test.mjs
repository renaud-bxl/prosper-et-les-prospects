import test from 'node:test';
import assert from 'node:assert/strict';
import { findPhones, normaliserTelephone, paysDuSite, langueDuSite, estPageUtile, reservationReperee, findEmails, lire } from '../server/agents/lecteur.mjs';

test('téléphones Benelux : international, préfixe 00 et format local selon pays', () => {
  for (const [raw, country, expected] of [
    ['02 123 45 67', 'BE', '+3221234567'], ['0470/12.34.56', 'BE', '+32470123456'],
    ['0032 (0)2 1234567', null, '+3221234567'], ['+32 470 12 34 56', 'NL', '+32470123456'],
    ['020 123 4567', 'NL', '+31201234567'], ['06-12345678', 'NL', '+31612345678'],
    ['+31 (0)20 123 4567', null, '+31201234567'], ['0031 20 1234567', null, '+31201234567'],
    ['26 12 34 56', 'LU', '+35226123456'], ['621 123 456', 'LU', '+352621123456'],
    ['+352 26 12 34 56', null, '+35226123456'], ['00352 621 123 456', null, '+352621123456'],
  ]) assert.equal(normaliserTelephone(raw, country), expected, raw);
  assert.equal(normaliserTelephone('0201234567'), null, 'un numéro local sans pays reste ambigu');
  for (const raw of ['+32 012345678', '+31 0612345678', '+352 123', '123456', 'javascript:12345678']) {
    assert.equal(normaliserTelephone(raw, 'BE'), null, raw);
  }
});

test('extraction téléphone : liens, texte, dédoublonnage et Luxembourg sans zéro', () => {
  assert.deepEqual(findPhones('<a href="tel:+32%202%20123%2045%2067">02 123 45 67</a>', 'BE'), ['+3221234567']);
  assert.deepEqual(findPhones('<p>Telefoon: 020 1234567</p><p>Mobiel: 06 12345678</p>', 'NL'), ['+31201234567', '+31612345678']);
  assert.deepEqual(findPhones('<p>Téléphone : 26123456</p><p>621 123 456</p>', 'LU'), ['+352621123456', '+35226123456']);
  assert.deepEqual(findPhones('<p>Numéro dossier : 26123456</p>', 'LU'), []);
  assert.doesNotThrow(() => findPhones('<a href="tel:%ZZ">&#999999999999;</a>', 'BE'));
});

test('le pays est explicite ou fondé sur le TLD ; aucune langue déduite du pays', () => {
  assert.equal(paysDuSite({ pays: 'nl' }, 'exemple.com'), 'NL');
  assert.equal(paysDuSite({}, 'exemple.lu'), 'LU');
  assert.equal(paysDuSite({}, 'exemple.com'), null);
  assert.deepEqual(langueDuSite('<html lang="nl-BE">'), { langue: 'nl', langue_source: 'html[lang]' });
  assert.equal(langueDuSite('<html data-lang="nl" lang="fr-LU">').langue, 'fr');
  assert.equal(langueDuSite('<html><a hreflang="nl">Nederlands</a>').langue, null);
  assert.equal(langueDuSite('<html lang="de-LU">').langue, null);
});

test('contact et réservation repérés dans les langues du Benelux', () => {
  for (const path of ['/contactgegevens', '/over-ons', '/reserveren', '/online-boeken', '/kontakt', '/impressum', '/tisch-buchen', '/booking']) {
    assert.equal(estPageUtile({ url: `https://example.nl${path}`, text: '' }), true, path);
  }
  for (const text of ['Réserver une table', 'Reserveer een tafel', 'Tafel reserveren', 'Online boeken', 'Book a table', 'Online reservieren', 'Tisch buchen']) {
    assert.ok(reservationReperee(`<button>${text}</button>`), text);
  }
  assert.equal(reservationReperee('<p>Notre équipe vous accueille.</p>'), null);
});

test('les domaines ressemblants ne deviennent pas des contacts du commerce', () => {
  assert.deepEqual(findEmails('<a href="mailto:info@vraicommerce.be">contact</a><a href="mailto:spam@fauxvraicommerce.be">web</a>', 'vraicommerce.be'), ['info@vraicommerce.be']);
  assert.doesNotThrow(() => findEmails('<a href="mailto:%ZZ@example.nl">contact</a>', 'example.nl'));
});

test('lecture réelle du parcours avec réponses HTTP locales simulées, sans réseau', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const fixtures = {
    'https://voorbeeld.nl/': '<html lang="nl-NL"><title>De Tafel</title><meta name="viewport"><a href="/contactgegevens">Contactgegevens</a><a href="/reserveren">Reserveer een tafel</a></html>',
    'https://voorbeeld.nl/contactgegevens': '<p>info@voorbeeld.nl</p><p>Telefoon: 020 1234567</p>',
    'https://voorbeeld.nl/reserveren': '<p>Online reserveren via Formitable</p>',
  };
  globalThis.fetch = async (url) => {
    calls.push(url);
    assert.ok(fixtures[url], `page inattendue : ${url}`);
    const response = new Response(fixtures[url], { headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  try {
    const result = await lire({ website: 'https://voorbeeld.nl/', pays: 'NL' }, { resolver: async () => [{ address: '93.184.216.34', family: 4 }] });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 3);
    assert.equal(result.signals.langue, 'nl');
    assert.equal(result.signals.reservation_en_ligne, 'Formitable');
    assert.deepEqual(result.emails, ['info@voorbeeld.nl']);
    assert.deepEqual(result.telephones, ['+31201234567']);
    assert.equal(result.email_source, '/contactgegevens');
  } finally { globalThis.fetch = originalFetch; }
});
