// Fabrique le circuit n8n du standardiste vocal (bâtiment) à partir de la logique testée et de config-client.json.
// Usage : node construire.js   ->   n8n/1.2-standardiste-vocal-batiment.n8n.json
// Versions de blocs : celles déjà validées sur l'instance n8n 2.46 du catalogue.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { chargerConfig, aRemplir, HORS_CODE } = require('./charger-config.js');

const ICI = __dirname;
const complet = chargerConfig(ICI);
const manque = aRemplir(complet);
// Ce qui sert à construire le circuit (clés, mode, tables) ne doit pas être recopié dans le code des blocs.
const { cleFinAppel, cleFonctions, sheetUrl = '', modeAgenda, tableRdv, tableJournal, ntfyIdentifiant, anthropicIdentifiant } = complet;
const cfg = Object.fromEntries(Object.entries(complet).filter(([k]) => !HORS_CODE.includes(k)));
const DEMO = modeAgenda === 'demo';
const SMS = cfg.smsActifs === true;
if (manque.length) console.log('À remplir dans .env :\n  - ' + manque.join('\n  - '));
const logique = fs.readFileSync(path.join(ICI, 'logique', 'logique.js'), 'utf8')
  .replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '')
  .trim();

const uid = (s) => {
  const h = crypto.createHash('md5').update('vx-1.2-batiment-' + s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const code = (corps, avecCfg = true) => [
  '// Logique VorcheX (copie de logique/logique.js, testée par tests/test-logique.js). Ne pas modifier ici :',
  '// modifier logique.js ou config-client.json puis relancer « node construire.js ».',
  logique,
  avecCfg ? `\nconst CFG = ${JSON.stringify(cfg, null, 2)};` : '',
  '',
  corps,
].join('\n');

const P = 'Vérifier et préparer'; // bloc de référence des données de l'appel
const nodes = [];
const connections = {};
const add = (name, type, typeVersion, position, parameters, extra = {}) => {
  nodes.push({ parameters, id: uid(name), name, type, typeVersion, position, ...extra });
};
const lien = (de, vers, sortie = 0, type = 'main') => {
  connections[de] = connections[de] || {};
  const c = (connections[de][type] = connections[de][type] || []);
  while (c.length <= sortie) c.push([]);
  c[sortie].push({ node: vers, type, index: 0 });
};
const agenda = { __rl: true, mode: 'id', value: `={{ $('${P}').first().json.cfg.agenda }}` };
const continuerSiErreur = { onError: 'continueRegularOutput' };
const table = (id) => ({ __rl: true, mode: 'id', value: id });
const colonne = (id, type = 'string') => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type, canBeUsedToMatch: true });
const smsCoupe = SMS ? {} : { disabled: true }; // SMS_ACTIFS=non : bloc grisé, l'appel continue sans SMS
// Lecture des rendez-vous : Google Agenda (mode google) ou table de données n8n (mode démo).
const lireAgenda = (nom, position, min, max) => (DEMO
  ? add(nom, 'n8n-nodes-base.dataTable', 1.1, position, {
    resource: 'row', operation: 'get', dataTableId: table(tableRdv), returnAll: true, filters: {},
  }, { alwaysOutputData: true })
  : add(nom, 'n8n-nodes-base.googleCalendar', 1.3, position, {
    operation: 'getAll', calendar: agenda, returnAll: true, timeMin: min, timeMax: max,
    options: { recurringEventHandling: 'expand' },
  }, { alwaysOutputData: true }));
// Une ligne de la table (debut/fin) ou un événement Google -> même forme pour la logique.
const VERS_EVENEMENTS = 'const evenements = $input.all().map((i) => versEvenement(i.json)).filter(Boolean);';
const ELEMENTS = 'const elements = $input.all().map((i) => i.json).filter((e) => e && (e.debut || e.start));';

// Alertes sur le téléphone du dirigeant (ntfy). Le sujet est protégé : jeton dans l'identifiant n8n « ntfy VorcheX ».
const ntfyAuth = ntfyIdentifiant ? { authentication: 'genericCredentialType', genericAuthType: 'httpBearerAuth' } : {};
const ntfyCred = ntfyIdentifiant ? { credentials: { httpBearerAuth: { id: ntfyIdentifiant, name: 'ntfy VorcheX' } } } : {};
const alerteNtfy = (nom, position, { titre, message, priorite = 'default', tags = '', photo = false }) => add(
  nom, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: photo ? 'PUT' : 'POST', url: cfg.ntfyUrl, ...ntfyAuth,
    // Paramètres dans l'adresse plutôt qu'en en-têtes : les accents passent sans encodage spécial.
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: 'title', value: titre }, { name: 'priority', value: priorite },
        ...(tags ? [{ name: 'tags', value: tags }] : []),
        ...(photo ? [{ name: 'message', value: message }, { name: 'filename', value: '={{ $json.nomFichier }}' }] : []),
      ],
    },
    sendBody: true,
    ...(photo
      ? { contentType: 'binaryData', inputDataFieldName: 'photo' }
      : { contentType: 'raw', rawContentType: 'text/plain', body: message }),
    options: { timeout: photo ? 20000 : 5000 },
  }, { ...continuerSiErreur, ...ntfyCred },
);
const sms = (nom, position, vers, message) => add(nom, 'n8n-nodes-base.twilio', 1, position, {
  resource: 'sms', operation: 'send', from: cfg.numeroSms, to: vers, message, options: {},
}, { ...continuerSiErreur, ...smsCoupe });
const filtreId = { matchType: 'allConditions', filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: '={{ $json.id }}' }] } };

// ---------------------------------------------------------------- Note
add('Mode d’emploi VorcheX', 'n8n-nodes-base.stickyNote', 1, [-560, -360], {
  width: 720, height: 640, color: 5,
  content: [
    '## 1.2 · Standardiste vocal IA — artisan du bâtiment (VorcheX)',
    'Version corrigée et testée de la fiche 1.2. **Désactivé par défaut.**',
    '',
    '**Pendant l’appel** : Retell appelle le webhook « Fonction de l’agent » (adresse avec `?cle=…`) avec `verifier_creneaux`, `reserver_rdv`, `signaler_urgence`, `trouver_rdv`, `annuler_rdv` ou `deplacer_rdv`. La réponse revient à l’agent, qui la dit à voix haute.',
    '**Photo** : chaque rendez-vous a un lien de formulaire (« Photo du client ») ; la photo arrive sur le téléphone du dirigeant (ntfy).',
    `**Chaque soir à ${cfg.heureRecap || 19} h** (dimanche → vendredi) : récapitulatif au dirigeant (ntfy) + SMS de rappel aux clients du lendemain.`,
    DEMO ? `**Chaque nuit à 3 h** : effacement du journal de plus de ${cfg.conservationJournalJours} jours et des rendez-vous passés depuis plus de ${cfg.conservationRdvJours} jours (RGPD).` : '**Conservation** : purger Google Sheets et Google Agenda selon la durée annoncée aux clients (RGPD).',
    ntfyIdentifiant ? '**ntfy** : identifiant « ntfy VorcheX » branché.' : '**ntfy** : identifiant « ntfy VorcheX » À CRÉER (sinon les alertes sont refusées), puis NTFY_IDENTIFIANT dans .env.',
    DEMO
      ? '**Après l’appel** : Retell envoie `call_analyzed` au webhook « Fin d’appel » (adresse avec `?cle=…`) → résumé par Claude → une ligne dans la table « Journal des appels ».'
      : '**Après l’appel** : Retell envoie `call_analyzed` au webhook « Fin d’appel » (adresse avec `?cle=…`) → résumé par Claude → une ligne dans Google Sheets.',
    '',
    DEMO
      ? '**Mode démo** : agenda et journal dans les tables de données n8n « Démo Garnier ». Seul identifiant nécessaire : Anthropic.'
      : '**Identifiants à créer** : Google Agenda, Twilio, Anthropic, Google Sheets.',
    SMS ? '**SMS** : actifs (identifiant Twilio requis).' : '**SMS** : coupés (blocs grisés). Pour les activer : identifiant Twilio dans n8n, SMS_ACTIFS=oui dans .env, puis `node construire.js`.',
    '**Informations de la démo** : fichier .env (numéros, agenda, Google Sheets), puis `node construire.js`. Les clés API ne vont jamais dans .env : uniquement dans les identifiants n8n.',
    '',
    'Guide complet : GUIDE-BRANCHEMENT.md',
  ].join('\n'),
});

// ---------------------------------------------------------------- Pendant l'appel
add('Fonction de l’agent', 'n8n-nodes-base.webhook', 2.1, [-560, 300], {
  httpMethod: 'POST', path: 'vx-batiment-fonctions',
  responseMode: 'responseNode', options: {},
}, { webhookId: uid('webhook-fonctions') });

add(P, 'n8n-nodes-base.code', 2, [-340, 300], {
  jsCode: code([
    `const CLE = ${JSON.stringify(cleFonctions)};`,
    'const entree = $input.first().json;',
    '// Retell passe la clé dans l’adresse (?cle=...) : sans elle, rien n’est lu ni écrit.',
    "if (!entree.query || entree.query.cle !== CLE) return [{ json: { route: 3, resultat: 'Accès refusé.' } }];",
    'return [{ json: preparerDemande(entree.body || {}, CFG, new Date()) }];',
  ].join('\n')),
});
lien('Fonction de l’agent', P);

add('Quelle demande ?', 'n8n-nodes-base.switch', 3.2, [-120, 300], {
  mode: 'expression', numberOutputs: 7, output: '={{ $json.route }}', options: {},
});
lien(P, 'Quelle demande ?');

// Sortie 0 : vérifier les créneaux
lireAgenda('Agenda : rendez-vous existants', [140, 0], '={{ $json.timeMin }}', '={{ $json.timeMax }}');
lien('Quelle demande ?', 'Agenda : rendez-vous existants', 0);

add('Calculer les créneaux libres', 'n8n-nodes-base.code', 2, [380, 0], {
  jsCode: code([
    `const prep = $('${P}').first().json;`,
    VERS_EVENEMENTS,
    'return [{ json: messageCreneaux(creneauxLibres(evenements, prep.demande, prep.cfg, new Date())) }];',
  ].join('\n'), false),
});
lien('Agenda : rendez-vous existants', 'Calculer les créneaux libres');

// Sortie 1 : réserver
lireAgenda('Agenda : créneau encore libre ?', [140, 260], '={{ $json.rdv.controleMin }}', '={{ $json.rdv.controleMax }}');
lien('Quelle demande ?', 'Agenda : créneau encore libre ?', 1);

add('Contrôle anti double réservation', 'n8n-nodes-base.code', 2, [380, 260], {
  jsCode: code([
    `const prep = $('${P}').first().json;`,
    VERS_EVENEMENTS,
    'const deb = new Date(prep.rdv.debut).getTime();',
    'const fin = new Date(prep.rdv.fin).getTime();',
    'const libre = !chevauche(deb, fin, intervallesOccupes(evenements), (prep.cfg.margeTrajetMin || 0) * 60000);',
    'return [{ json: { libre, ...prep.rdv, sms: smsConfirmation(prep.rdv, prep.cfg) } }];',
  ].join('\n'), false),
});
lien('Agenda : créneau encore libre ?', 'Contrôle anti double réservation');

add('Libre ?', 'n8n-nodes-base.if', 2.2, [600, 260], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: uid('cond-libre'), leftValue: '={{ $json.libre }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
lien('Contrôle anti double réservation', 'Libre ?');

const champsRdv = ['debut', 'fin', 'nom', 'telephone', 'adresse', 'motif', 'appel_id'];
if (DEMO) {
  add('Créer le rendez-vous', 'n8n-nodes-base.dataTable', 1.1, [820, 180], {
    resource: 'row', operation: 'insert', dataTableId: table(tableRdv),
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(champsRdv.map((c) => [c, c === 'appel_id'
        ? `={{ $('${P}').first().json.appelId || '' }}` : `={{ $json.${c} }}`])),
      matchingColumns: [], schema: champsRdv.map((c) => colonne(c)),
      attemptToConvertTypes: false, convertFieldsToString: false,
    },
    options: {},
  });
} else {
  add('Créer le rendez-vous', 'n8n-nodes-base.googleCalendar', 1.3, [820, 180], {
    calendar: agenda, start: '={{ $json.debut }}', end: '={{ $json.fin }}',
    additionalFields: {
      summary: '={{ "RDV " + $json.motif + " – " + $json.nom }}',
      location: '={{ $json.adresse }}',
      description: '={{ "Pris par le standardiste IA.\\nClient : " + $json.nom + "\\nTéléphone : " + $json.telephone + "\\nMotif : " + $json.motif }}',
    },
  });
}
lien('Libre ?', 'Créer le rendez-vous', 0);

// Lien du formulaire photo, signé avec la clé des fonctions (identifiant du rendez-vous créé).
add('Lien photo', 'n8n-nodes-base.code', 2, [1040, 180], {
  jsCode: code([
    `const CLE = ${JSON.stringify(cleFonctions)};`,
    "const r = $('Contrôle anti double réservation').first().json;",
    'const cree = $input.first().json || {};',
    "const ref = cree.id !== undefined && cree.id !== null ? String(cree.id) : '';",
    "const lien = ref ? lienPhoto(CFG, ref, CLE) : '';",
    'return [{ json: {',
    '  ref, lien, sms: smsConfirmation(r, CFG, lien),',
    "  alerte: `${r.libelle} – ${r.nom} ${r.telephone} – ${r.adresse} – ${r.motif}` + (lien ? `\\nLien photo pour le client : ${lien}` : ''),",
    '} }];',
  ].join('\n')),
});
lien('Créer le rendez-vous', 'Lien photo');

sms('SMS de confirmation', [1260, 180], "={{ $('Contrôle anti double réservation').first().json.telephone }}", "={{ $('Lien photo').first().json.sms }}");
lien('Lien photo', 'SMS de confirmation');

alerteNtfy('Alerte nouveau rendez-vous (ntfy)', [1480, 180], {
  titre: 'Nouveau rendez-vous', tags: 'calendar', message: "={{ $('Lien photo').first().json.alerte }}",
});
lien('SMS de confirmation', 'Alerte nouveau rendez-vous (ntfy)');

add('Message : rendez-vous réservé', 'n8n-nodes-base.code', 2, [1700, 180], {
  jsCode: [
    "const r = $('Contrôle anti double réservation').first().json;",
    `const SMS_ACTIFS = ${SMS};`,
    "const sms = SMS_ACTIFS && !$('SMS de confirmation').first().json.error && r.mobile;",
    'return [{ json: { resultat: `Rendez-vous réservé : ${r.libelle}. Confirme-le à l’appelant`'
      + " + (sms ? ' et dis-lui qu’il reçoit un SMS de confirmation, avec un lien pour envoyer une photo du problème.' : '.') } }];",
  ].join('\n'),
});
lien('Alerte nouveau rendez-vous (ntfy)', 'Message : rendez-vous réservé');

add('Message : créneau déjà pris', 'n8n-nodes-base.code', 2, [820, 360], {
  jsCode: "return [{ json: { resultat: 'Ce créneau vient d’être pris. Excuse-toi, vérifie de nouveau les créneaux et propose les suivants.' } }];",
});
lien('Libre ?', 'Message : créneau déjà pris', 1);

// Sortie 2 : urgence
sms('SMS d’urgence au dirigeant', [140, 520], cfg.numeroDirigeant,
  '={{ ' + `"URGENCE " + $json.cfg.nomEntreprise + " - " + $json.urgence.description + " - " + $json.urgence.nom + ", " + $json.urgence.telephone + ", " + $json.urgence.adresse` + ' }}');
lien('Quelle demande ?', 'SMS d’urgence au dirigeant', 2);

alerteNtfy('Alerte téléphone (ntfy)', [380, 520], {
  titre: 'Urgence client', priorite: 'urgent', tags: 'rotating_light',
  message: `={{ $('${P}').first().json.urgence.description + " - " + $('${P}').first().json.urgence.nom + " " + $('${P}').first().json.urgence.telephone + " - " + $('${P}').first().json.urgence.adresse }}`,
});
lien('SMS d’urgence au dirigeant', 'Alerte téléphone (ntfy)');

add('Message : transférer', 'n8n-nodes-base.code', 2, [600, 520], {
  jsCode: "return [{ json: { resultat: 'Le dirigeant est prévenu. Dis à l’appelant que tu le mets en relation tout de suite, puis appelle la fonction transfer_call. Si le transfert échoue, dis que le dirigeant le rappelle au plus vite et donne une consigne de sécurité simple (couper l’eau ou le gaz au compteur si possible).' } }];",
});
lien('Alerte téléphone (ntfy)', 'Message : transférer');

// Sortie 3 : demande invalide -> directement à la réponse
add('Réponse à l’agent', 'n8n-nodes-base.respondToWebhook', 1.1, [1960, 600], {
  respondWith: 'json',
  responseBody: '={{ JSON.stringify(Object.assign({ resultat: $json.resultat, creneaux: $json.creneaux || [] }, $json.rendez_vous ? { rendez_vous: $json.rendez_vous } : {})) }}',
  options: {},
});
lien('Quelle demande ?', 'Réponse à l’agent', 3);

// Sortie 4 : retrouver les rendez-vous d'un client (par son numéro)
lireAgenda('Agenda : rendez-vous du client', [140, 760], '={{ $json.timeMin }}', '={{ $json.timeMax }}');
lien('Quelle demande ?', 'Agenda : rendez-vous du client', 4);
add('Rendez-vous du client', 'n8n-nodes-base.code', 2, [380, 760], {
  jsCode: code([
    `const prep = $('${P}').first().json;`, ELEMENTS,
    'return [{ json: messageRdvTrouves(rdvDuClient(elements, prep.recherche.telephone, new Date())) }];',
  ].join('\n'), false),
});
lien('Agenda : rendez-vous du client', 'Rendez-vous du client');

// Sortie 5 : annuler (seulement si le numéro correspond au rendez-vous)
lireAgenda('Agenda : rendez-vous à annuler', [140, 1000], '={{ $json.timeMin }}', '={{ $json.timeMax }}');
lien('Quelle demande ?', 'Agenda : rendez-vous à annuler', 5);
add('Contrôle de l’annulation', 'n8n-nodes-base.code', 2, [380, 1000], {
  jsCode: code([
    `const prep = $('${P}').first().json;`, ELEMENTS,
    'return [{ json: controlerModification(elements, prep.modif, prep.cfg, new Date()) }];',
  ].join('\n'), false),
});
lien('Agenda : rendez-vous à annuler', 'Contrôle de l’annulation');
const siOk = (nom, position) => add(nom, 'n8n-nodes-base.if', 2.2, position, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: uid('cond-' + nom), leftValue: '={{ $json.ok }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
siOk('Annulation possible ?', [600, 1000]);
lien('Contrôle de l’annulation', 'Annulation possible ?');
if (DEMO) {
  add('Supprimer le rendez-vous', 'n8n-nodes-base.dataTable', 1.1, [820, 940], {
    resource: 'row', operation: 'deleteRows', dataTableId: table(tableRdv), ...filtreId, options: {},
  }, { alwaysOutputData: true });
} else {
  add('Supprimer le rendez-vous', 'n8n-nodes-base.googleCalendar', 1.3, [820, 940], {
    operation: 'delete', calendar: agenda, eventId: '={{ $json.id }}', options: {},
  }, { alwaysOutputData: true });
}
lien('Annulation possible ?', 'Supprimer le rendez-vous', 0);
alerteNtfy('Alerte annulation (ntfy)', [1040, 940], {
  titre: 'Rendez-vous annulé', tags: 'x', message: "={{ $('Contrôle de l’annulation').first().json.alerte }}",
});
lien('Supprimer le rendez-vous', 'Alerte annulation (ntfy)');
add('Message : annulation', 'n8n-nodes-base.code', 2, [1260, 940], {
  jsCode: "return [{ json: { resultat: $('Contrôle de l’annulation').first().json.resultat } }];",
});
lien('Alerte annulation (ntfy)', 'Message : annulation');
lien('Annulation possible ?', 'Réponse à l’agent', 1);

// Sortie 6 : déplacer (même contrôle + nouveau créneau libre, le rendez-vous lui-même mis à part)
lireAgenda('Agenda : avant déplacement', [140, 1240], '={{ $json.timeMin }}', '={{ $json.timeMax }}');
lien('Quelle demande ?', 'Agenda : avant déplacement', 6);
add('Contrôle du déplacement', 'n8n-nodes-base.code', 2, [380, 1240], {
  jsCode: code([
    `const prep = $('${P}').first().json;`, ELEMENTS,
    'return [{ json: controlerModification(elements, prep.modif, prep.cfg, new Date()) }];',
  ].join('\n'), false),
});
lien('Agenda : avant déplacement', 'Contrôle du déplacement');
siOk('Déplacement possible ?', [600, 1240]);
lien('Contrôle du déplacement', 'Déplacement possible ?');
if (DEMO) {
  add('Déplacer le rendez-vous', 'n8n-nodes-base.dataTable', 1.1, [820, 1180], {
    resource: 'row', operation: 'update', dataTableId: table(tableRdv), ...filtreId,
    columns: {
      mappingMode: 'defineBelow',
      value: { debut: '={{ $json.nouveau.debut }}', fin: '={{ $json.nouveau.fin }}' },
      matchingColumns: [], schema: [colonne('debut'), colonne('fin')],
      attemptToConvertTypes: false, convertFieldsToString: false,
    },
    options: {},
  }, { alwaysOutputData: true });
} else {
  add('Déplacer le rendez-vous', 'n8n-nodes-base.googleCalendar', 1.3, [820, 1180], {
    operation: 'update', calendar: agenda, eventId: '={{ $json.id }}',
    updateFields: { start: '={{ $json.nouveau.debut }}', end: '={{ $json.nouveau.fin }}' },
  }, { alwaysOutputData: true });
}
lien('Déplacement possible ?', 'Déplacer le rendez-vous', 0);
sms('SMS de déplacement', [1040, 1180], "={{ $('Contrôle du déplacement').first().json.telephone }}", "={{ $('Contrôle du déplacement').first().json.sms }}");
lien('Déplacer le rendez-vous', 'SMS de déplacement');
alerteNtfy('Alerte déplacement (ntfy)', [1260, 1180], {
  titre: 'Rendez-vous déplacé', tags: 'arrows_counterclockwise', message: "={{ $('Contrôle du déplacement').first().json.alerte }}",
});
lien('SMS de déplacement', 'Alerte déplacement (ntfy)');
add('Message : déplacement', 'n8n-nodes-base.code', 2, [1480, 1180], {
  jsCode: [
    "const c = $('Contrôle du déplacement').first().json;",
    `const SMS_ACTIFS = ${SMS};`,
    "const sms = SMS_ACTIFS && !$('SMS de déplacement').first().json.error && c.mobile;",
    "return [{ json: { resultat: c.resultat + (sms ? ' Dis-lui qu’il reçoit un SMS de confirmation.' : '') } }];",
  ].join('\n'),
});
lien('Alerte déplacement (ntfy)', 'Message : déplacement');
lien('Déplacement possible ?', 'Réponse à l’agent', 1);

for (const n of ['Calculer les créneaux libres', 'Message : rendez-vous réservé', 'Message : créneau déjà pris', 'Message : transférer',
  'Rendez-vous du client', 'Message : annulation', 'Message : déplacement']) {
  lien(n, 'Réponse à l’agent');
}

// ---------------------------------------------------------------- Photo envoyée par le client (formulaire)
add('Photo du client', 'n8n-nodes-base.formTrigger', 2.5, [-560, 1560], {
  formTitle: `Photo pour ${cfg.nomEntreprise}`,
  formDescription: 'Envoyez une photo du problème (fuite, chaudière, compteur…) : l’artisan arrivera avec le bon matériel.',
  formFields: {
    values: [
      { fieldLabel: 'Photo du problème', fieldName: 'photo', fieldType: 'file', multipleFiles: false, acceptFileTypes: '.jpg,.jpeg,.png,.webp,.heic', requiredField: true },
      { fieldLabel: 'Un mot sur le problème (facultatif)', fieldName: 'commentaire', fieldType: 'textarea' },
      { fieldName: 'ref', fieldType: 'hiddenField' },
      { fieldName: 'k', fieldType: 'hiddenField' },
    ],
  },
  responseMode: 'onReceived',
  // Version 2.5 : l'adresse (/form/vx-batiment-photo) et le message de fin se règlent dans les options.
  options: {
    path: 'vx-batiment-photo', buttonLabel: 'Envoyer la photo', appendAttribution: false, ignoreBots: true,
    respondWithOptions: { values: { respondWith: 'text', formSubmittedText: `Merci ! Votre photo a bien été transmise à ${cfg.nomEntreprise}.` } },
  },
}, { webhookId: uid('form-photo') });

add('Contrôler le lien photo', 'n8n-nodes-base.code', 2, [-340, 1560], {
  jsCode: code([
    `const CLE = ${JSON.stringify(cleFonctions)};`,
    'const item = $input.first();',
    'const j = item.json || {};',
    '// Lien sans la bonne signature (ref modifié, lien inventé) : rien n’est envoyé.',
    'if (!lienPhotoValide(j.ref, j.k, CLE)) return [];',
    'const b = item.binary || {};',
    'const champ = Object.keys(b)[0];',
    'if (!champ) return [];',
    'const m = new Date();',
    'return [{',
    '  json: {',
    "    ref: String(j.ref), commentaire: String(j.commentaire || j['Un mot sur le problème (facultatif)'] || '').trim().slice(0, 300),",
    '    timeMin: isoParis(new Date(m.getTime() - 86400000)), timeMax: isoParis(new Date(m.getTime() + 120 * 86400000)),',
    '  },',
    '  binary: { photo: b[champ] },',
    '}];',
  ].join('\n'), false),
});
lien('Photo du client', 'Contrôler le lien photo');

lireAgenda('Agenda : rendez-vous de la photo', [-120, 1560], '={{ $json.timeMin }}', '={{ $json.timeMax }}');
lien('Contrôler le lien photo', 'Agenda : rendez-vous de la photo');

add('Préparer la photo', 'n8n-nodes-base.code', 2, [100, 1560], {
  jsCode: code([
    "const c = $('Contrôler le lien photo').first();",
    'const r = $input.all().map((i) => versRdv(i.json)).find((x) => x && x.id === c.json.ref);',
    'const texte = r',
    "  ? `${r.nom} ${r.telephone} – RDV ${libelleParis(lireDate(r.debut))} au ${r.adresse} – ${r.motif}`",
    "  : `Rendez-vous ${c.json.ref} introuvable (annulé ?)`;",
    "const ext = String((c.binary.photo && c.binary.photo.fileExtension) || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';",
    "const nom = String((r && r.nom) || 'client').normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';",
    'return [{',
    "  json: { message: texte + (c.json.commentaire ? `\\nCommentaire : ${c.json.commentaire}` : ''), nomFichier: `photo-${nom}.${ext}` },",
    '  binary: c.binary,',
    '}];',
  ].join('\n'), false),
});
lien('Agenda : rendez-vous de la photo', 'Préparer la photo');

alerteNtfy('Photo au dirigeant (ntfy)', [320, 1560], { titre: 'Photo d’un client', tags: 'camera', message: '={{ $json.message }}', photo: true });
lien('Préparer la photo', 'Photo au dirigeant (ntfy)');

// ---------------------------------------------------------------- Chaque soir : récapitulatif + rappels de la veille
add(`Récap du soir (${cfg.heureRecap || 19} h)`, 'n8n-nodes-base.scheduleTrigger', 1.2, [-560, 1820], {
  rule: { interval: [{ field: 'cronExpression', expression: `0 ${cfg.heureRecap || 19} * * 0-5` }] },
});
add('Fenêtre du récap', 'n8n-nodes-base.code', 2, [-340, 1820], {
  jsCode: code([
    'const demain = ajouterJours(jourParis(new Date()), 1);',
    "return [{ json: { timeMin: isoParis(depuisHeureParis(demain + 'T00:00')), timeMax: isoParis(depuisHeureParis(ajouterJours(demain, 1) + 'T00:00')) } }];",
  ].join('\n'), false),
});
lien(`Récap du soir (${cfg.heureRecap || 19} h)`, 'Fenêtre du récap');
lireAgenda('Agenda : rendez-vous de demain', [-120, 1820], '={{ $json.timeMin }}', '={{ $json.timeMax }}');
lien('Fenêtre du récap', 'Agenda : rendez-vous de demain');
if (DEMO) {
  add('Lire le journal', 'n8n-nodes-base.dataTable', 1.1, [100, 1820], {
    resource: 'row', operation: 'get', dataTableId: table(tableJournal), returnAll: true, filters: {},
  }, { alwaysOutputData: true, executeOnce: true });
} else {
  add('Lire le journal', 'n8n-nodes-base.googleSheets', 4.5, [100, 1820], {
    operation: 'read', documentId: { __rl: true, mode: 'url', value: sheetUrl },
    sheetName: { __rl: true, mode: 'name', value: 'Appels' }, options: {},
  }, { alwaysOutputData: true, executeOnce: true });
}
lien('Agenda : rendez-vous de demain', 'Lire le journal');
add('Préparer le récapitulatif', 'n8n-nodes-base.code', 2, [320, 1820], {
  jsCode: code([
    'const lignes = $input.all().map((i) => i.json);',
    "const rdvs = $('Agenda : rendez-vous de demain').all().map((i) => i.json);",
    'return [{ json: recapitulatif(lignes, rdvs, CFG, new Date()) }];',
  ].join('\n')),
});
lien('Lire le journal', 'Préparer le récapitulatif');
alerteNtfy('Récap au dirigeant (ntfy)', [540, 1820], { titre: '={{ $json.titre }}', tags: 'clipboard', message: '={{ $json.message }}' });
lien('Préparer le récapitulatif', 'Récap au dirigeant (ntfy)');
add('Rappels à envoyer', 'n8n-nodes-base.code', 2, [760, 1820], {
  jsCode: "return $('Préparer le récapitulatif').first().json.rappels.map((r) => ({ json: r }));",
});
lien('Récap au dirigeant (ntfy)', 'Rappels à envoyer');
sms('SMS de rappel (veille)', [980, 1820], '={{ $json.telephone }}', '={{ $json.sms }}');
lien('Rappels à envoyer', 'SMS de rappel (veille)');

// ---------------------------------------------------------------- Chaque nuit : conservation limitée (mode démo)
if (DEMO) {
  add('Purge nocturne (3 h)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-560, 2080], {
    rule: { interval: [{ field: 'cronExpression', expression: '0 3 * * *' }] },
  });
  const purge = (quoi, idTable, champ, jours, y) => {
    add(`${quoi} : tout lire`, 'n8n-nodes-base.dataTable', 1.1, [-340, y], {
      resource: 'row', operation: 'get', dataTableId: table(idTable), returnAll: true, filters: {},
    });
    lien('Purge nocturne (3 h)', `${quoi} : tout lire`);
    add(`${quoi} : lignes trop anciennes`, 'n8n-nodes-base.code', 2, [-120, y], {
      jsCode: code([
        `return lignesAPurger($input.all().map((i) => i.json), '${champ}', CFG.${jours}, new Date()).map((x) => ({ json: x }));`,
      ].join('\n')),
    });
    lien(`${quoi} : tout lire`, `${quoi} : lignes trop anciennes`);
    add(`${quoi} : effacer`, 'n8n-nodes-base.dataTable', 1.1, [100, y], {
      resource: 'row', operation: 'deleteRows', dataTableId: table(idTable), ...filtreId, options: {},
    });
    lien(`${quoi} : lignes trop anciennes`, `${quoi} : effacer`);
  };
  purge('Journal', tableJournal, 'date', 'conservationJournalJours', 2080);
  purge('Rendez-vous', tableRdv, 'fin', 'conservationRdvJours', 2260);
}

// ---------------------------------------------------------------- Après l'appel
add('Fin d’appel', 'n8n-nodes-base.webhook', 2.1, [-560, 2520], {
  httpMethod: 'POST', path: 'vx-batiment-fin-appel', responseMode: 'onReceived', options: {},
}, { webhookId: uid('webhook-fin-appel') });

add('Filtrer : clé et appel analysé', 'n8n-nodes-base.code', 2, [-340, 2520], {
  jsCode: [
    `const CLE = ${JSON.stringify(cleFinAppel)};`,
    'const e = $input.first().json;',
    '// Retell ne permet pas d’en-tête sur ce webhook : la clé est passée dans l’adresse (?cle=...).',
    'if (!e.query || e.query.cle !== CLE) return [];',
    'const b = e.body || {};',
    "if (b.event !== 'call_analyzed' || !b.call) return []; // call_started / call_ended ignorés",
    "return [{ json: { call: b.call, transcript: b.call.transcript || '(aucune parole)' } }];",
  ].join('\n'),
});
lien('Fin d’appel', 'Filtrer : clé et appel analysé');

add('Résumé et motif', '@n8n/n8n-nodes-langchain.informationExtractor', 1.2, [-100, 2520], {
  text: '={{ $json.transcript }}',
  schemaType: 'fromAttributes',
  attributes: {
    attributes: [
      { name: 'motif', type: 'string', required: true, description: "Motif principal, un seul mot parmi : devis, rendez-vous, urgence, suivi, demarchage, information, autre" },
      { name: 'urgent', type: 'boolean', required: true, description: "Vrai seulement si l'appelant décrit une urgence (fuite importante, plus de chauffage en hiver, odeur de gaz, dégât des eaux)" },
      { name: 'rendez_vous_pris', type: 'boolean', required: true, description: "Vrai si l'agent a confirmé une réservation pendant l'appel" },
      { name: 'nom', type: 'string', required: false, description: "Nom de l'appelant s'il l'a donné" },
      { name: 'adresse', type: 'string', required: false, description: "Adresse d'intervention si elle a été donnée" },
      { name: 'suite_a_donner', type: 'string', required: true, description: 'Action concrète pour le dirigeant, en une phrase (ou « aucune »)' },
      { name: 'resume', type: 'string', required: true, description: "Résumé de l'appel en deux phrases maximum, en français" },
    ],
  },
  options: {
    systemPromptTemplate: "Tu lis la transcription d'un appel reçu par le standardiste IA d'une entreprise du bâtiment. Extrais uniquement ce qui est dit dans l'appel, sans rien inventer. Si une information est absente, laisse le champ vide.",
  },
});
lien('Filtrer : clé et appel analysé', 'Résumé et motif');

add('Claude (Résumé et motif)', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.6, [-100, 2720], {
  model: { __rl: true, mode: 'id', value: 'claude-haiku-5-5' }, options: {},
}, anthropicIdentifiant ? { credentials: { anthropicApi: { id: anthropicIdentifiant, name: 'Anthropic account' } } } : {});
lien('Claude (Résumé et motif)', 'Résumé et motif', 0, 'ai_languageModel');

add('Ligne du journal', 'n8n-nodes-base.code', 2, [180, 2520], {
  jsCode: code([
    "const appel = $('Filtrer : clé et appel analysé').first().json.call;",
    'return [{ json: ligneJournal(appel, $input.first().json.output) }];',
  ].join('\n'), false),
});
lien('Résumé et motif', 'Ligne du journal');

if (DEMO) {
  const champsJournal = ['date', 'appel_id', 'numero', 'duree_s', 'motif', 'urgent', 'rdv_pris', 'nom', 'adresse', 'suite', 'resume', 'fin_appel'];
  add('Journal des appels', 'n8n-nodes-base.dataTable', 1.1, [420, 2520], {
    resource: 'row', operation: 'insert', dataTableId: table(tableJournal),
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(champsJournal.map((c) => [c, `={{ $json.${c} }}`])),
      matchingColumns: [], schema: champsJournal.map((c) => colonne(c, c === 'duree_s' ? 'number' : 'string')),
      attemptToConvertTypes: false, convertFieldsToString: false,
    },
    options: {},
  });
} else {
  add('Journal des appels', 'n8n-nodes-base.googleSheets', 4.5, [420, 2520], {
    operation: 'append',
    documentId: { __rl: true, mode: 'url', value: sheetUrl },
    sheetName: { __rl: true, mode: 'name', value: 'Appels' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
    options: {},
  });
}
lien('Ligne du journal', 'Journal des appels');

// ---------------------------------------------------------------- Écriture
const workflow = {
  name: `1.2 · Standardiste vocal IA — ${cfg.nomEntreprise} (bâtiment, VorcheX)`,
  nodes, connections, active: false,
  settings: { executionOrder: 'v1', timezone: 'Europe/Paris', saveDataSuccessExecution: 'all' },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};
fs.mkdirSync(path.join(ICI, 'n8n'), { recursive: true });
const sortie = path.join(ICI, 'n8n', '1.2-standardiste-vocal-batiment.n8n.json');
fs.writeFileSync(sortie, JSON.stringify(workflow, null, 2));
console.log(`${nodes.length} blocs écrits dans ${path.relative(ICI, sortie)}`);
