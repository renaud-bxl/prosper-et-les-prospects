import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBusinesses, missingDrafts } from '../web/src/results-model.js';

const places = [
  { id: 'a', name: 'Atelier', status: 'ecarte', emails: [], address: 'Bruxelles' },
  { id: 'b', name: 'Café', status: 'en_attente', to_email: 'qa@example.invalid', mail: 'Bonjour', website: 'https://cafe.example.invalid' },
  { id: 'c', name: 'Salon', status: 'erreur', emails: ['qa@example.invalid'], address: 'Anvers' },
  { id: 'd', name: 'Librairie', status: 'trouve', emails: [], phone: '+3212345' },
  { id: 'e', name: 'Garage', status: 'refuse', to_email: 'qa@example.invalid' },
];
test('the complete directory includes rejected, unread and contactless businesses', () => {
  assert.equal(filterBusinesses(places).length, 5);
  assert.deepEqual(filterBusinesses(places, 'all', 'BRUXELLES').map(p => p.id), ['a']);
  assert.deepEqual(filterBusinesses(places, 'all', '12345').map(p => p.id), ['d']);
  assert.deepEqual(filterBusinesses(places, 'all', 'cafe.example').map(p => p.id), ['b']);
});
test('ready emails and missing qualified drafts are separate from all visited businesses', () => {
  assert.deepEqual(filterBusinesses(places, 'ready').map(p => p.id), ['b']);
  assert.deepEqual(missingDrafts(places).map(p => p.id), ['c']);
  assert.deepEqual(filterBusinesses(places, 'todo').map(p => p.id), ['b', 'c']);
});
