// Tests de la logique du standardiste vocal. Lancer : node tests/test-logique.js
const assert = require('assert');
const L = require('../logique/logique.js');
const cfg = require('../config-client.json');

let ok = 0;
const t = (nom, fn) => { try { fn(); ok++; console.log('OK  ', nom); } catch (e) { console.log('ÉCHEC', nom, '\n     ', e.message); process.exitCode = 1; } };

// Mercredi 18 novembre 2026, 21 h à Paris (un appel le soir, hors horaires)
const soir = L.depuisHeureParis('2026-11-18T21:00');

t('heure d’hiver : 9 h à Paris = 8 h UTC', () => {
  assert.strictEqual(L.depuisHeureParis('2026-11-24T09:00').toISOString(), '2026-11-24T08:00:00.000Z');
});
t('heure d’été : 9 h à Paris = 7 h UTC', () => {
  assert.strictEqual(L.depuisHeureParis('2026-07-07T09:00').toISOString(), '2026-07-07T07:00:00.000Z');
});
t('passage à l’heure d’été (29 mars 2026)', () => {
  assert.strictEqual(L.isoParis(L.depuisHeureParis('2026-03-30T10:00')), '2026-03-30T10:00:00+02:00');
  assert.strictEqual(L.isoParis(L.depuisHeureParis('2026-03-27T10:00')), '2026-03-27T10:00:00+01:00');
});
t('date impossible refusée', () => assert.strictEqual(L.depuisHeureParis('2026-02-31T10:00'), null));
t('libellé lisible à voix haute', () => {
  assert.strictEqual(L.libelleParis(L.depuisHeureParis('2026-12-01T14:30')), 'mardi 1er décembre à 14 h 30');
});

t('téléphones dictés', () => {
  assert.strictEqual(L.normaliserTelephone('06 12 34 56 78'), '+33612345678');
  assert.strictEqual(L.normaliserTelephone('0033 6 12 34 56 78'), '+33612345678');
  assert.strictEqual(L.normaliserTelephone('+33 1 23 45 67 89'), '+33123456789');
  assert.strictEqual(L.normaliserTelephone('12 34'), null);
  assert.strictEqual(L.estMobile('+33712345678'), true);
  assert.strictEqual(L.estMobile('+33123456789'), false);
});

t('fonction inconnue -> route d’erreur', () => {
  const r = L.preparerDemande({ name: 'pirater', args: {} }, cfg, soir);
  assert.strictEqual(r.route, 3);
});

t('vérifier les créneaux : agenda vide, le soir -> à partir du lendemain', () => {
  const d = L.preparerDemande({ name: 'verifier_creneaux', args: {} }, cfg, soir);
  assert.strictEqual(d.route, 0);
  assert.strictEqual(d.demande.jourDebut, '2026-11-19');
  const c = L.creneauxLibres([], d.demande, cfg, soir);
  assert.deepStrictEqual(c.map((x) => x.debut), ['2026-11-19T08:00', '2026-11-19T14:00', '2026-11-20T08:00']);
  assert.ok(L.messageCreneaux(c).resultat.includes('jeudi 19 novembre à 8 h'));
});

t('créneaux : respecte les rendez-vous existants et la marge de trajet', () => {
  const d = L.preparerDemande({ name: 'verifier_creneaux', args: { date: '2026-11-19', partie_journee: 'matin' } }, cfg, soir);
  const evts = [{ start: { dateTime: '2026-11-19T08:00:00+01:00' }, end: { dateTime: '2026-11-19T10:00:00+01:00' } }];
  const c = L.creneauxLibres(evts, d.demande, cfg, soir);
  // 8 h–10 h pris, + 30 min de trajet -> premier créneau 10 h 30
  assert.strictEqual(c[0].debut, '2026-11-19T10:30');
  assert.ok(c.every((x) => +x.debut.slice(11, 13) < 12), 'matin seulement');
});

t('créneaux : un jour bloqué entier (congés) est sauté, le week-end aussi', () => {
  const d = L.preparerDemande({ name: 'verifier_creneaux', args: { date: '2026-11-20' } }, cfg, soir);
  const evts = [{ start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }];
  const c = L.creneauxLibres(evts, d.demande, cfg, soir);
  assert.strictEqual(c[0].debut, '2026-11-23T08:00'); // vendredi bloqué, samedi/dimanche fermés -> lundi
});

t('créneaux : délai minimum de 2 h respecté le jour même', () => {
  // 8 h 40 -> au plus tôt 10 h 40 -> créneau de 11 h (finit à midi, pile à la fermeture)
  const matin = L.depuisHeureParis('2026-11-19T08:40');
  const d = L.preparerDemande({ name: 'verifier_creneaux', args: { date: '2026-11-19' } }, cfg, matin);
  assert.strictEqual(L.creneauxLibres([], d.demande, cfg, matin)[0].debut, '2026-11-19T11:00');
  // 9 h 10 -> au plus tôt 11 h 10 -> 11 h 30 finirait à 12 h 30 : on passe à 14 h
  const plusTard = L.depuisHeureParis('2026-11-19T09:10');
  const d2 = L.preparerDemande({ name: 'verifier_creneaux', args: { date: '2026-11-19' } }, cfg, plusTard);
  assert.strictEqual(L.creneauxLibres([], d2.demande, cfg, plusTard)[0].debut, '2026-11-19T14:00');
});

t('créneaux : événements annulés ou « disponible » ignorés', () => {
  const d = L.preparerDemande({ name: 'verifier_creneaux', args: { date: '2026-11-19' } }, cfg, soir);
  const evts = [
    { status: 'cancelled', start: { dateTime: '2026-11-19T08:00:00+01:00' }, end: { dateTime: '2026-11-19T12:00:00+01:00' } },
    { transparency: 'transparent', start: { dateTime: '2026-11-19T08:00:00+01:00' }, end: { dateTime: '2026-11-19T12:00:00+01:00' } },
  ];
  assert.strictEqual(L.creneauxLibres(evts, d.demande, cfg, soir)[0].debut, '2026-11-19T08:00');
});

const rdvValide = { nom: 'Mme Dupont', telephone: '06 12 34 56 78', adresse: '12 rue des Lilas, Montreuil', motif: 'Fuite sous évier', debut: '2026-11-19T14:00' };

t('réservation valide', () => {
  const r = L.preparerDemande({ name: 'reserver_rdv', args: rdvValide, call: { call_id: 'c1' } }, cfg, soir);
  assert.strictEqual(r.route, 1);
  assert.strictEqual(r.rdv.telephone, '+33612345678');
  assert.strictEqual(r.rdv.debut, '2026-11-19T14:00:00+01:00');
  assert.strictEqual(r.rdv.fin, '2026-11-19T15:00:00+01:00');
  assert.ok(L.smsConfirmation(r.rdv, cfg).includes('jeudi 19 novembre à 14 h'));
});
t('réservation : champ manquant -> l’agent doit redemander', () => {
  const r = L.preparerDemande({ name: 'reserver_rdv', args: { ...rdvValide, adresse: '' } }, cfg, soir);
  assert.strictEqual(r.route, 3);
  assert.ok(r.resultat.includes('adresse'));
});
t('réservation : hors horaires refusée (dimanche, 19 h, débordement)', () => {
  for (const debut of ['2026-11-22T10:00', '2026-11-19T19:00', '2026-11-19T11:30', '2026-11-20T16:30']) {
    assert.strictEqual(L.preparerDemande({ name: 'reserver_rdv', args: { ...rdvValide, debut } }, cfg, soir).route, 3, debut);
  }
});
t('réservation : jour férié configuré refusé', () => {
  const r = L.preparerDemande({ name: 'reserver_rdv', args: { ...rdvValide, debut: '2026-12-25T09:00' } }, cfg, soir);
  assert.strictEqual(r.route, 3);
});
t('réservation : créneau passé refusé', () => {
  assert.strictEqual(L.preparerDemande({ name: 'reserver_rdv', args: { ...rdvValide, debut: '2026-11-18T14:00' } }, cfg, soir).route, 3);
});
t('réservation : numéro dicté invalide -> numéro de l’appelant utilisé', () => {
  const r = L.preparerDemande({ name: 'reserver_rdv', args: { ...rdvValide, telephone: '06 12' }, call: { from_number: '+33698765432' } }, cfg, soir);
  assert.strictEqual(r.rdv.telephone, '+33698765432');
});

t('urgence : alerte construite', () => {
  const r = L.preparerDemande({ name: 'signaler_urgence', args: { nom: 'M. Petit', description: 'Fuite importante, eau au plafond', adresse: '3 av. Foch' }, call: { from_number: '+33611111111' } }, cfg, soir);
  assert.strictEqual(r.route, 2);
  assert.ok(L.alerteUrgence(r.urgence, cfg).includes('+33611111111'));
});
t('urgence sans description refusée', () => {
  assert.strictEqual(L.preparerDemande({ name: 'signaler_urgence', args: {} }, cfg, soir).route, 3);
});

t('journal : une ligne par appel', () => {
  const l = L.ligneJournal(
    { call_id: 'c9', from_number: '+33612345678', start_timestamp: soir.getTime(), end_timestamp: soir.getTime() + 185000, disconnection_reason: 'user_hangup' },
    { motif: 'rendez-vous', urgent: false, rendez_vous_pris: true, nom: 'Mme Dupont' });
  assert.strictEqual(l.date, '2026-11-18 21:00');
  assert.strictEqual(l.duree_s, 185);
  assert.strictEqual(l.rdv_pris, 'oui');
});

// ---------- Retrouver, annuler, déplacer
const lignesRdv = [
  { id: 1, debut: '2026-11-19T14:00:00+01:00', fin: '2026-11-19T15:00:00+01:00', nom: 'Mme Dupont', telephone: '+33612345678', adresse: '12 rue des Lilas', motif: 'Fuite' },
  { id: 2, debut: '2026-11-20T09:00:00+01:00', fin: '2026-11-20T10:00:00+01:00', nom: 'M. Petit', telephone: '+33611111111', adresse: '3 av. Foch', motif: 'Chaudière' },
  { id: 3, debut: '2026-11-10T09:00:00+01:00', fin: '2026-11-10T10:00:00+01:00', nom: 'Mme Dupont', telephone: '+33612345678', adresse: '12 rue des Lilas', motif: 'Ancien' },
];
t('trouver_rdv : seulement les rendez-vous à venir du numéro', () => {
  const r = L.messageRdvTrouves(L.rdvDuClient(lignesRdv, '+33612345678', soir));
  assert.strictEqual(r.rendez_vous.length, 1);
  assert.strictEqual(r.rendez_vous[0].id, '1');
  assert.ok(r.resultat.startsWith('Rendez-vous trouvé : jeudi 19 novembre à 14 h'));
  assert.strictEqual(L.rdvDuClient(lignesRdv, '+33699999999', soir).length, 0);
});
t('trouver_rdv : événement Google (description structurée) reconnu', () => {
  const ev = { id: 'abc', start: { dateTime: '2026-11-19T14:00:00+01:00' }, end: { dateTime: '2026-11-19T15:00:00+01:00' }, location: '12 rue des Lilas', description: 'Pris par le standardiste IA.\nClient : Mme Dupont\nTéléphone : +33612345678\nMotif : Fuite' };
  const r = L.rdvDuClient([ev], '+33612345678', soir);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].motif, 'Fuite');
});
t('annuler : numéro différent -> refus ; bon numéro -> annulation', () => {
  assert.strictEqual(L.controlerModification(lignesRdv, { id: '1', telephone: '+33611111111' }, cfg, soir).ok, false);
  const c = L.controlerModification(lignesRdv, { id: '1', telephone: '+33612345678' }, cfg, soir);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.action, 'annuler');
  assert.strictEqual(c.id, 1); // identifiant brut (nombre) pour la table n8n
});
t('annuler : rendez-vous passé refusé', () => {
  assert.strictEqual(L.controlerModification(lignesRdv, { id: '3', telephone: '+33612345678' }, cfg, soir).ok, false);
});
t('déplacer : vers un créneau pris par un autre client -> refus', () => {
  const d = L.preparerDemande({ name: 'deplacer_rdv', args: { id: '1', telephone: '06 12 34 56 78', debut: '2026-11-20T10:00' } }, cfg, soir);
  assert.strictEqual(d.route, 6);
  assert.strictEqual(L.controlerModification(lignesRdv, d.modif, cfg, soir).ok, false);
});
t('déplacer : chevauchement avec lui-même accepté, SMS prêt', () => {
  const d = L.preparerDemande({ name: 'deplacer_rdv', args: { id: '1', telephone: '06 12 34 56 78', debut: '2026-11-19T15:00' } }, cfg, soir);
  const c = L.controlerModification(lignesRdv, d.modif, cfg, soir);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.nouveau.debut, '2026-11-19T15:00:00+01:00');
  assert.ok(c.sms.includes('déplacé au jeudi 19 novembre à 15 h'));
});
t('annuler / déplacer : identifiant ou numéro manquant -> erreur', () => {
  assert.strictEqual(L.preparerDemande({ name: 'annuler_rdv', args: { telephone: '0612345678' } }, cfg, soir).route, 3);
  assert.strictEqual(L.preparerDemande({ name: 'annuler_rdv', args: { id: '1' } }, cfg, soir).route, 3);
  assert.strictEqual(L.preparerDemande({ name: 'annuler_rdv', args: { id: '1' }, call: { from_number: '+33612345678' } }, cfg, soir).route, 5);
  assert.strictEqual(L.preparerDemande({ name: 'deplacer_rdv', args: { id: '1', telephone: '0612345678' } }, cfg, soir).route, 3);
});

// ---------- Lien photo
t('lien photo : signé, vérifiable, infalsifiable sans la clé', () => {
  const lien = L.lienPhoto({ urlFormPhoto: 'https://n8n.exemple/form/p' }, 7, 'cle-secrete');
  const u = new URL(lien);
  assert.strictEqual(u.searchParams.get('ref'), '7');
  assert.ok(L.lienPhotoValide('7', u.searchParams.get('k'), 'cle-secrete'));
  assert.ok(!L.lienPhotoValide('8', u.searchParams.get('k'), 'cle-secrete'));
  assert.ok(!L.lienPhotoValide('7', u.searchParams.get('k'), 'autre-cle'));
  assert.ok(!L.lienPhotoValide('7', '', 'cle-secrete'));
});
t('SMS de confirmation : lien photo ajouté seulement s’il existe', () => {
  const rdv = { libelle: 'jeudi 19 novembre à 14 h', adresse: '12 rue des Lilas' };
  assert.ok(L.smsConfirmation(rdv, cfg, 'https://x/f?ref=1&k=a').includes('photo du problème : https://x/f?ref=1&k=a'));
  assert.ok(!L.smsConfirmation(rdv, cfg, '').includes('photo'));
});

// ---------- Récapitulatif du soir
const journal = [
  { id: 1, date: '2026-11-18 10:12', nom: 'Mme Dupont', numero: '+33612345678', rdv_pris: 'oui', urgent: 'non', suite: 'aucune' },
  { id: 2, date: '2026-11-18 16:40', nom: 'M. Martin', numero: '+33698765432', rdv_pris: 'non', urgent: 'non', suite: 'Rappeler pour un devis de chaudière' },
  { id: 3, date: '2026-11-18 18:05', nom: '', numero: '', rdv_pris: 'non', urgent: 'oui', suite: 'Vérifier la fuite' },
  { id: 4, date: '2026-11-16 09:00', nom: 'Trop ancien', rdv_pris: 'oui', urgent: 'non', suite: 'x' },
];
t('récap : appels des dernières 24 h, à rappeler, RDV de demain, rappels SMS', () => {
  const r = L.recapitulatif(journal, [...lignesRdv, { id: 9, debut: '2026-11-19T16:00:00+01:00', fin: '2026-11-19T17:00:00+01:00', nom: 'Fixe', telephone: '+33123456789', adresse: 'a', motif: 'b' }], cfg, L.depuisHeureParis('2026-11-18T19:00'));
  assert.strictEqual(r.nbAppels, 3);
  assert.strictEqual(r.nbRdv, 1);
  assert.strictEqual(r.nbUrgences, 1);
  assert.strictEqual(r.nbDemain, 2);
  assert.ok(r.message.includes('À rappeler :\n• M. Martin +33698765432 : Rappeler pour un devis de chaudière'));
  assert.ok(r.message.includes('• 14 h Mme Dupont – 12 rue des Lilas – Fuite'));
  assert.strictEqual(r.rappels.length, 1); // le numéro fixe ne reçoit pas de SMS
  assert.ok(r.rappels[0].sms.includes('demain à 14 h'));
});
t('récap du dimanche : remonte jusqu’au vendredi soir', () => {
  const r = L.recapitulatif([{ date: '2026-11-21 10:00', rdv_pris: 'non', suite: 'Rappeler' }], [], cfg, L.depuisHeureParis('2026-11-22T19:00'));
  assert.strictEqual(r.nbAppels, 1);
  assert.ok(r.message.includes('depuis vendredi 19 h'));
  assert.ok(r.message.includes('Aucun rendez-vous.'));
});
t('récap : journal vide (élément vide de n8n) sans erreur', () => {
  const r = L.recapitulatif([{}], [{}], cfg, soir);
  assert.strictEqual(r.nbAppels, 0);
  assert.strictEqual(r.rappels.length, 0);
});

// ---------- Purge (conservation limitée)
t('purge : seules les lignes plus anciennes que la durée sont effacées', () => {
  const p = L.lignesAPurger([
    { id: 1, date: '2025-11-01 10:00' }, { id: 2, date: '2026-11-01 10:00' }, { id: 3, date: '' }, { date: '2020-01-01 10:00' },
  ], 'date', 365, soir);
  assert.deepStrictEqual(p, [{ id: 1 }]);
  assert.deepStrictEqual(L.lignesAPurger(lignesRdv, 'fin', 5, soir), [{ id: 3 }]);
});

console.log(`\n${ok} tests réussis${process.exitCode ? ', au moins un échec' : ''}.`);
