// Simulation du circuit n8n généré : structure + exécution des blocs « Code » avec un faux n8n.
// Les blocs Google Agenda, Twilio, ntfy et Claude sont remplacés par des réponses fictives.
// Lancer : node tests/test-circuit.js   (après node construire.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', '1.2-standardiste-vocal-batiment.n8n.json'), 'utf8'));
const parNom = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const CONF = require('../charger-config.js').chargerConfig(path.join(__dirname, '..'));
const Q = { cle: CONF.cleFonctions }; // clé passée par Retell dans l'adresse
let ok = 0;
const t = (nom, fn) => { try { fn(); ok++; console.log('OK  ', nom); } catch (e) { console.log('ÉCHEC', nom, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; } };

// ---------- Structure
t('structure : chaque lien pointe vers un bloc existant', () => {
  for (const [de, types] of Object.entries(wf.connections)) {
    assert.ok(parNom[de], 'source inconnue ' + de);
    for (const sorties of Object.values(types)) for (const s of sorties) for (const c of s) assert.ok(parNom[c.node], 'cible inconnue ' + c.node);
  }
});
t('structure : le webhook des fonctions attend le bloc Réponse, sans identifiant à créer', () => {
  const w = parNom['Fonction de l’agent'].parameters;
  assert.strictEqual(w.responseMode, 'responseNode');
  assert.ok(!w.authentication || w.authentication === 'none');
});
t('structure : aucune clé ni identifiant de table dans le code recopié (CFG)', () => {
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    const m = /const CFG = (\{[\s\S]*?\n\});/.exec(n.parameters.jsCode);
    if (!m) continue;
    for (const k of ['cleFinAppel', 'cleFonctions', 'sheetUrl', 'tableRdv', 'tableJournal', 'modeAgenda']) assert.ok(!m[1].includes('"' + k + '"'), k + ' dans ' + n.name);
  }
});
t('structure : mode démo -> tables n8n, aucun bloc Google', () => {
  if (CONF.modeAgenda !== 'demo') return;
  assert.ok(!wf.nodes.some((n) => /google/i.test(n.type)));
  assert.strictEqual(parNom['Créer le rendez-vous'].parameters.dataTableId.value, CONF.tableRdv);
  assert.strictEqual(parNom['Journal des appels'].parameters.dataTableId.value, CONF.tableJournal);
  assert.strictEqual(parNom['Agenda : rendez-vous existants'].alwaysOutputData, true);
});
t('structure : SMS_ACTIFS=non -> blocs Twilio grisés', () => {
  const twilio = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.twilio');
  assert.strictEqual(twilio.length, 4);
  for (const n of twilio) {
    assert.strictEqual(!!n.disabled, !CONF.smsActifs, n.name);
    assert.strictEqual(n.onError, 'continueRegularOutput', n.name);
  }
});
t('structure : alertes ntfy -> identifiant « ntfy VorcheX » si renseigné, jamais bloquantes', () => {
  const ntfy = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.strictEqual(ntfy.length, 6);
  for (const n of ntfy) {
    assert.strictEqual(n.parameters.url, CONF.ntfyUrl, n.name);
    assert.strictEqual(n.onError, 'continueRegularOutput', n.name);
    if (CONF.ntfyIdentifiant) assert.strictEqual(n.credentials.httpBearerAuth.id, CONF.ntfyIdentifiant, n.name);
    else assert.ok(!n.credentials, n.name);
  }
  const photo = parNom['Photo au dirigeant (ntfy)'].parameters;
  assert.strictEqual(photo.method, 'PUT');
  assert.strictEqual(photo.inputDataFieldName, 'photo');
});
t('structure : formulaire photo, récap du soir, purge nocturne', () => {
  const f = parNom['Photo du client'].parameters;
  assert.strictEqual(f.options.path, 'vx-batiment-photo'); // v2.5 : adresse dans les options
  assert.ok(!f.path);
  assert.deepStrictEqual(f.formFields.values.filter((v) => v.fieldType === 'hiddenField').map((v) => v.fieldName), ['ref', 'k']);
  assert.ok(CONF.urlFormPhoto.endsWith('/form/vx-batiment-photo'));
  const recap = wf.nodes.find((n) => n.name.startsWith('Récap du soir'));
  assert.strictEqual(recap.parameters.rule.interval[0].expression, `0 ${CONF.heureRecap} * * 0-5`);
  assert.strictEqual(parNom['Lire le journal'].executeOnce, true);
  if (CONF.modeAgenda === 'demo') {
    assert.strictEqual(parNom['Purge nocturne (3 h)'].parameters.rule.interval[0].expression, '0 3 * * *');
    assert.strictEqual(parNom['Journal : effacer'].parameters.operation, 'deleteRows');
    assert.strictEqual(parNom['Rendez-vous : effacer'].parameters.dataTableId.value, CONF.tableRdv);
  }
});
t('structure : la réponse à l’agent transmet la liste des rendez-vous', () => {
  assert.ok(parNom['Réponse à l’agent'].parameters.responseBody.includes('rendez_vous'));
});
t('structure : les 7 sorties du tri mènent toutes à la Réponse', () => {
  const suivants = (n, vus = new Set()) => {
    if (vus.has(n)) return vus; vus.add(n);
    for (const s of ((wf.connections[n] || {}).main || [])) for (const c of s) suivants(c.node, vus);
    return vus;
  };
  const sorties = wf.connections['Quelle demande ?'].main;
  assert.strictEqual(sorties.length, 7);
  sorties.forEach((s, i) => assert.ok(suivants(s[0].node).has('Réponse à l’agent'), 'sortie ' + i));
});
t('structure : circuit désactivé, fuseau de Paris', () => {
  assert.strictEqual(wf.active, false);
  assert.strictEqual(wf.settings.timezone, 'Europe/Paris');
});

// ---------- Faux n8n pour les blocs Code
const route = (s) => s['Vérifier et préparer'].route;

// L'appel tombe un mercredi soir : on fige « maintenant » au 18/11/2026 21 h (Paris) pour des résultats stables.
const VraiDate = Date;
const MAINTENANT = new VraiDate('2026-11-18T20:00:00Z').getTime();
global.Date = class extends VraiDate { constructor(...a) { if (a.length) super(...a); else super(MAINTENANT); } static now() { return MAINTENANT; } };
const D = global.Date;
// s[nom] = json du 1er élément produit ; s.__el[nom] = tous les éléments (avec binaire) ; s.__el peut aussi
// recevoir la sortie d'un bloc non-Code (lecture de table, Twilio…) pour $('…').all().
const executerFige = (n, e, s) => {
  s.__el = s.__el || {};
  const els = (x) => s.__el[x] || [{ json: s[x] }];
  const $ = (x) => ({ first: () => els(x)[0], all: () => els(x) });
  const $input = { first: () => e[0], all: () => e };
  const ctx = vm.createContext({ $, $input, Intl, Date: D, JSON, Math, String, Number, Object, Array, URL, encodeURIComponent });
  const r = vm.runInContext(`(function(){\n${parNom[n].parameters.jsCode}\n})()`, ctx);
  s[n] = r[0] && r[0].json; s.__el[n] = r; return r;
};
const sortieDe = (s, n, elements) => { s.__el = s.__el || {}; s.__el[n] = elements; s[n] = elements[0] && elements[0].json; };

t('appel 1 : « quand pouvez-vous passer ? » -> 3 créneaux lus à voix haute', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'verifier_creneaux', args: {}, call: { call_id: 'a1', from_number: '+33612345678' } } } }], s);
  assert.strictEqual(route(s), 0);
  // Google Agenda : un chantier jeudi matin
  const agenda = [{ json: { start: { dateTime: '2026-11-19T08:00:00+01:00' }, end: { dateTime: '2026-11-19T11:00:00+01:00' } } }];
  executerFige('Calculer les créneaux libres', agenda, s);
  const r = s['Calculer les créneaux libres'];
  assert.strictEqual(r.creneaux.length, 3);
  assert.strictEqual(r.creneaux[0].debut, '2026-11-19T14:00');
  assert.ok(r.resultat.startsWith('Créneaux libres : jeudi 19 novembre à 14 h'));
});

t('appel 1 bis : agenda vide (Google ne renvoie rien) -> créneaux quand même', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'verifier_creneaux', args: { partie_journee: 'apres-midi' } } } }], s);
  executerFige('Calculer les créneaux libres', [{ json: {} }], s); // alwaysOutputData : un élément vide
  assert.ok(s['Calculer les créneaux libres'].creneaux.every((c) => +c.debut.slice(11, 13) >= 14));
});

const args = { nom: 'Mme Dupont', telephone: '06 12 34 56 78', adresse: '12 rue des Lilas, Montreuil', motif: 'Fuite sous évier', debut: '2026-11-19T14:00' };

t('appel 2 : réservation sur un créneau libre -> SMS prêt', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args, call: { call_id: 'a2' } } } }], s);
  assert.strictEqual(route(s), 1);
  executerFige('Contrôle anti double réservation', [{ json: {} }], s);
  const c = s['Contrôle anti double réservation'];
  assert.strictEqual(c.libre, true);
  assert.ok(c.sms.startsWith('Plomberie Garnier : RDV confirmé jeudi 19 novembre à 14 h'));
  sortieDe(s, 'SMS de confirmation', [{ json: { sid: 'SM123' } }]);
  executerFige('Message : rendez-vous réservé', [{ json: {} }], s);
  // SMS coupés : l'agent ne doit pas promettre de SMS
  assert.strictEqual(s['Message : rendez-vous réservé'].resultat.includes('SMS de confirmation'), CONF.smsActifs);
});

t('appel 2 bis : SMS en échec -> l’agent ne promet pas de SMS', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args } } }], s);
  executerFige('Contrôle anti double réservation', [{ json: {} }], s);
  sortieDe(s, 'SMS de confirmation', [{ json: { error: 'Twilio indisponible' } }]);
  executerFige('Message : rendez-vous réservé', [{ json: {} }], s);
  assert.ok(!s['Message : rendez-vous réservé'].resultat.includes('SMS'));
});

t('appel 3 : deux appelants sur le même créneau -> pas de double réservation', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args } } }], s);
  const dejaPris = [{ json: { start: { dateTime: '2026-11-19T14:00:00+01:00' }, end: { dateTime: '2026-11-19T15:00:00+01:00' } } }];
  executerFige('Contrôle anti double réservation', dejaPris, s);
  assert.strictEqual(s['Contrôle anti double réservation'].libre, false);
});

t('appel 0 : sans la clé dans l’adresse -> accès refusé', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: { cle: 'faux' }, body: { name: 'verifier_creneaux', args: {} } } }], s);
  assert.strictEqual(route(s), 3);
  assert.strictEqual(s['Vérifier et préparer'].resultat, 'Accès refusé.');
});

t('appel 1 ter : agenda lu dans la table n8n (lignes debut/fin) -> chantier respecté', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'verifier_creneaux', args: {} } } }], s);
  const lignes = [{ json: { id: 1, debut: '2026-11-19T08:00:00+01:00', fin: '2026-11-19T11:00:00+01:00', nom: 'X' } }];
  executerFige('Calculer les créneaux libres', lignes, s);
  assert.strictEqual(s['Calculer les créneaux libres'].creneaux[0].debut, '2026-11-19T14:00');
});

t('appel 3 bis : double réservation détectée depuis la table n8n', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args } } }], s);
  executerFige('Contrôle anti double réservation', [{ json: { debut: '2026-11-19T14:00:00+01:00', fin: '2026-11-19T15:00:00+01:00' } }], s);
  assert.strictEqual(s['Contrôle anti double réservation'].libre, false);
});

t('appel 4 : l’agent invente une heure hors horaires -> refus expliqué', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args: { ...args, debut: '2026-11-21T10:00' } } } }], s);
  assert.strictEqual(route(s), 3);
  assert.ok(s['Vérifier et préparer'].resultat.includes('horaires'));
});

t('appel 5 : urgence -> consigne de transfert', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'signaler_urgence', args: { nom: 'M. Petit', description: 'Eau qui coule du plafond', adresse: '3 av. Foch' }, call: { from_number: '+33611111111' } } } }], s);
  assert.strictEqual(route(s), 2);
  executerFige('Message : transférer', [{ json: {} }], s);
  assert.ok(s['Message : transférer'].resultat.includes('transfer_call'));
});

t('fin d’appel : mauvaise clé -> ignoré', () => {
  const s = {};
  const r = executerFige('Filtrer : clé et appel analysé', [{ json: { query: { cle: 'faux' }, body: { event: 'call_analyzed', call: {} } } }], s);
  assert.strictEqual(r.length, 0);
});
t('fin d’appel : call_ended ignoré, call_analyzed traité, ligne de journal', () => {
  const cle = CONF.cleFinAppel;
  const s = {};
  assert.strictEqual(executerFige('Filtrer : clé et appel analysé', [{ json: { query: { cle }, body: { event: 'call_ended', call: {} } } }], s).length, 0);
  const call = { call_id: 'a9', from_number: '+33612345678', start_timestamp: MAINTENANT, end_timestamp: MAINTENANT + 140000, transcript: 'Agent: Bonjour…' };
  assert.strictEqual(executerFige('Filtrer : clé et appel analysé', [{ json: { query: { cle }, body: { event: 'call_analyzed', call } } }], s).length, 1);
  executerFige('Ligne du journal', [{ json: { output: { motif: 'rendez-vous', urgent: false, rendez_vous_pris: true, resume: 'RDV pris.' } } }], s);
  const l = s['Ligne du journal'];
  assert.strictEqual(l.duree_s, 140);
  assert.strictEqual(l.date, '2026-11-18 21:00');
});

// ---------- Retrouver, annuler, déplacer (table n8n)
const TABLE = [
  { json: { id: 1, debut: '2026-11-19T14:00:00+01:00', fin: '2026-11-19T15:00:00+01:00', nom: 'Mme Dupont', telephone: '+33612345678', adresse: '12 rue des Lilas', motif: 'Fuite' } },
  { json: { id: 2, debut: '2026-11-20T09:00:00+01:00', fin: '2026-11-20T10:00:00+01:00', nom: 'M. Petit', telephone: '+33611111111', adresse: '3 av. Foch', motif: 'Chaudière' } },
];
const appelClient = (name, a) => ({ json: { query: Q, body: { name, args: a, call: { call_id: 'c1', from_number: '+33612345678' } } } });

t('appel 6 : « j’ai un rendez-vous, je veux le changer » -> retrouvé par le numéro de l’appelant', () => {
  const s = {};
  executerFige('Vérifier et préparer', [appelClient('trouver_rdv', {})], s);
  assert.strictEqual(route(s), 4);
  executerFige('Rendez-vous du client', TABLE, s);
  const r = s['Rendez-vous du client'];
  assert.strictEqual(r.rendez_vous.length, 1);
  assert.strictEqual(r.rendez_vous[0].id, '1');
  assert.ok(r.resultat.includes('jeudi 19 novembre à 14 h au 12 rue des Lilas'));
});
t('appel 7 : annulation par le bon client -> ligne 1 effacée, alerte prête', () => {
  const s = {};
  executerFige('Vérifier et préparer', [appelClient('annuler_rdv', { id: '1' })], s);
  assert.strictEqual(route(s), 5);
  executerFige('Contrôle de l’annulation', TABLE, s);
  const c = s['Contrôle de l’annulation'];
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.id, 1);
  assert.ok(c.alerte.startsWith('Annulé : Mme Dupont'));
  executerFige('Message : annulation', [{ json: {} }], s);
  assert.ok(s['Message : annulation'].resultat.includes('annulé'));
});
t('appel 7 bis : un autre numéro ne peut pas annuler le rendez-vous de Mme Dupont', () => {
  const s = {};
  executerFige('Vérifier et préparer', [appelClient('annuler_rdv', { id: '1', telephone: '06 11 11 11 11' })], s);
  executerFige('Contrôle de l’annulation', TABLE, s);
  assert.strictEqual(s['Contrôle de l’annulation'].ok, false);
});
t('appel 8 : déplacement -> nouveau créneau libre, SMS et message', () => {
  const s = {};
  executerFige('Vérifier et préparer', [appelClient('deplacer_rdv', { id: '1', debut: '2026-11-20T15:00' })], s);
  assert.strictEqual(route(s), 6);
  executerFige('Contrôle du déplacement', TABLE, s);
  const c = s['Contrôle du déplacement'];
  assert.strictEqual(c.ok, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify([c.nouveau.debut, c.nouveau.fin])), ['2026-11-20T15:00:00+01:00', '2026-11-20T16:00:00+01:00']);
  sortieDe(s, 'SMS de déplacement', [{ json: { sid: 'SM1' } }]);
  executerFige('Message : déplacement', [{ json: {} }], s);
  assert.strictEqual(s['Message : déplacement'].resultat.includes('SMS'), CONF.smsActifs);
});
t('appel 8 bis : déplacement sur le créneau d’un autre client -> refusé', () => {
  const s = {};
  executerFige('Vérifier et préparer', [appelClient('deplacer_rdv', { id: '1', debut: '2026-11-20T10:00' })], s);
  executerFige('Contrôle du déplacement', TABLE, s);
  assert.strictEqual(s['Contrôle du déplacement'].ok, false);
});

// ---------- Photo
t('réservation : lien photo signé dans le SMS et l’alerte', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args } } }], s);
  executerFige('Contrôle anti double réservation', [{ json: {} }], s);
  executerFige('Lien photo', [{ json: { id: 12, debut: '…' } }], s);
  const l = s['Lien photo'];
  assert.strictEqual(l.ref, '12');
  assert.ok(l.lien.startsWith(CONF.urlFormPhoto + '?ref=12&k='));
  assert.ok(l.sms.includes(l.lien));
  assert.ok(l.alerte.includes('Lien photo pour le client'));
  // table qui ne renverrait pas d'identifiant : pas de lien, SMS normal
  executerFige('Lien photo', [{ json: {} }], s);
  assert.strictEqual(s['Lien photo'].lien, '');
});
t('photo : lien valide -> photo transmise avec le rendez-vous ; lien trafiqué -> rien', () => {
  const s = {};
  executerFige('Vérifier et préparer', [{ json: { query: Q, body: { name: 'reserver_rdv', args } } }], s);
  executerFige('Contrôle anti double réservation', [{ json: {} }], s);
  executerFige('Lien photo', [{ json: { id: 1 } }], s);
  const k = new URL(s['Lien photo'].lien).searchParams.get('k');
  const binaire = { data: 'xxx', mimeType: 'image/jpeg', fileName: 'IMG_0001.JPG', fileExtension: 'jpg' };
  const p = {};
  assert.strictEqual(executerFige('Contrôler le lien photo', [{ json: { ref: '2', k, commentaire: '' }, binary: { Photo_du_probleme: binaire } }], p).length, 0);
  assert.strictEqual(executerFige('Contrôler le lien photo', [{ json: { ref: '1', k }, binary: {} }], p).length, 0);
  executerFige('Contrôler le lien photo', [{ json: { ref: '1', k, commentaire: 'Sous l’évier' }, binary: { Photo_du_probleme: binaire } }], p);
  assert.strictEqual(p.__el['Contrôler le lien photo'][0].binary.photo, binaire);
  const r = executerFige('Préparer la photo', TABLE, p);
  assert.ok(r[0].json.message.startsWith('Mme Dupont +33612345678 – RDV jeudi 19 novembre à 14 h'));
  assert.ok(r[0].json.message.endsWith('Commentaire : Sous l’évier'));
  assert.strictEqual(r[0].json.nomFichier, 'photo-Mme-Dupont.jpg');
  assert.strictEqual(r[0].binary.photo, binaire);
});

// ---------- Récap du soir (mercredi 18/11, 21 h figé : demain = jeudi 19)
t('récap : fenêtre = journée de demain, message et rappels', () => {
  const s = {};
  executerFige('Fenêtre du récap', [{ json: {} }], s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s['Fenêtre du récap'])), { timeMin: '2026-11-19T00:00:00+01:00', timeMax: '2026-11-20T00:00:00+01:00' });
  sortieDe(s, 'Agenda : rendez-vous de demain', TABLE);
  executerFige('Préparer le récapitulatif', [{ json: { id: 5, date: '2026-11-18 17:00', nom: 'M. Martin', numero: '+33698765432', rdv_pris: 'non', urgent: 'non', suite: 'Rappeler pour un devis' } }], s);
  const r = s['Préparer le récapitulatif'];
  assert.strictEqual(r.titre, 'Plomberie Garnier · récap du mercredi 18 novembre');
  assert.ok(r.message.includes('• M. Martin +33698765432 : Rappeler pour un devis'));
  assert.strictEqual(r.nbDemain, 1);
  executerFige('Rappels à envoyer', [{ json: {} }], s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.__el['Rappels à envoyer'].map((i) => i.json.telephone))), ['+33612345678']);
});
t('purge : seules les lignes trop anciennes partent à l’effacement', () => {
  if (CONF.modeAgenda !== 'demo') return;
  const s = {};
  const r = executerFige('Journal : lignes trop anciennes', [{ json: { id: 1, date: '2024-01-01 10:00' } }, { json: { id: 2, date: '2026-11-18 10:00' } }], s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.map((i) => i.json))), [{ id: 1 }]); // objets venus du bac à sable : comparés par leur contenu
  assert.strictEqual(executerFige('Rendez-vous : lignes trop anciennes', TABLE, s).length, 0);
});

global.Date = VraiDate;
console.log(`\n${ok} tests réussis${process.exitCode ? ', au moins un échec' : ''}.`);
