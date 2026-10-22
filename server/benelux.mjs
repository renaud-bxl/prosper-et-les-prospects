import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const countries = JSON.parse(readFileSync(join(ROOT, 'web/public/carte/pays.json'), 'utf8')).pays.filter(p=>['BE','NL','LU'].includes(p.cc));

function inside(lon, lat, ring) {
  let hit = false;
  for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
    const [x,y]=ring[i], [xx,yy]=ring[j];
    if ((y>lat)!==(yy>lat) && lon < (xx-x)*(lat-y)/(yy-y)+x) hit=!hit;
  }
  return hit;
}

export function countryAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return countries.find(p=>p.rings.some(r=>inside(lon,lat,r)))?.cc ?? null;
}

export function validateMission(body, config) {
  if (!body.centre || !Number.isFinite(+body.centre.lat) || !Number.isFinite(+body.centre.lon)) throw new Error('Choisissez une ville du Benelux.');
  const cc = countryAt(+body.centre.lat, +body.centre.lon);
  if (!cc || (body.pays && body.pays!==cc)) throw new Error('La ville doit se situer en Belgique, aux Pays-Bas ou au Luxembourg.');
  for (const key of ['rayon_m','nombre','objectif_mails']) {
    if (body[key]!=null && !Number.isFinite(+body[key])) throw new Error('Paramètre numérique invalide.');
  }
  if (body.redaction && !['claude','codex','aucun'].includes(body.redaction.moteur)) throw new Error('Moteur de rédaction inconnu.');
  if (body.redaction?.langue && !['auto','fr','nl','en'].includes(body.redaction.langue)) throw new Error('Langue inconnue.');
  if (body.redaction?.modele && !/^[\w.:-]{1,80}$/.test(body.redaction.modele)) throw new Error('Nom de modèle invalide.');
  const offer = body.offre ?? config.offre;
  const redaction = body.redaction ?? config.redaction;
  if (redaction?.moteur !== 'aucun' && (!offer?.ce_que_je_vends?.trim() || !offer?.signature?.trim())) throw new Error('Renseignez votre offre et votre signature.');
  return cc;
}
