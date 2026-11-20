// Réunit config-client.json (réglages du métier) et .env (informations de la démo et clés générées).
// Les valeurs du .env l'emportent. Aucune clé API n'est lue ici : elles vivent dans les identifiants n8n.
const fs = require('fs');
const path = require('path');

const CORRESPONDANCE = {
  NOM_ENTREPRISE: 'nomEntreprise',
  NUMERO_AFFICHE: 'numeroAffiche',
  NUMERO_DIRIGEANT: 'numeroDirigeant',
  NUMERO_SMS_TWILIO: 'numeroSms',
  AGENDA_ID: 'agenda',
  GOOGLE_SHEET_URL: 'sheetUrl',
  NTFY_URL: 'ntfyUrl',
  NTFY_IDENTIFIANT: 'ntfyIdentifiant',
  ANTHROPIC_IDENTIFIANT: 'anthropicIdentifiant',
  CLE_FIN_APPEL: 'cleFinAppel',
  CLE_FONCTIONS: 'cleFonctions',
  MODE_AGENDA: 'modeAgenda',
  TABLE_RDV: 'tableRdv',
  TABLE_JOURNAL: 'tableJournal',
  SMS_ACTIFS: 'smsActifs',
};

function lireEnv(fichier) {
  const res = {};
  if (!fs.existsSync(fichier)) return res;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ligne);
    if (m) res[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return res;
}

function chargerConfig(dossier = __dirname) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dossier, 'config-client.json'), 'utf8'));
  delete cfg._note;
  const env = lireEnv(path.join(dossier, '.env'));
  for (const [cle, champ] of Object.entries(CORRESPONDANCE)) {
    if (env[cle] !== undefined && env[cle] !== '') cfg[champ] = env[cle];
  }
  if (!cfg.cleFinAppel) throw new Error('CLE_FIN_APPEL manquante dans .env');
  if (!cfg.cleFonctions) throw new Error('CLE_FONCTIONS manquante dans .env');
  cfg.modeAgenda = cfg.modeAgenda === 'google' ? 'google' : 'demo';
  cfg.smsActifs = String(cfg.smsActifs || 'non').toLowerCase() === 'oui';
  if (cfg.modeAgenda === 'demo' && (!cfg.tableRdv || !cfg.tableJournal)) {
    throw new Error('Mode démo : TABLE_RDV et TABLE_JOURNAL doivent être remplis dans .env');
  }
  cfg.urlFormPhoto = String(cfg.urlN8n || '').replace(/\/$/, '') + '/form/vx-batiment-photo';
  return cfg;
}

// Ce qui reste à remplir, en français, pour prévenir avant de construire.
function aRemplir(cfg) {
  const manque = [];
  const tel = /^\+\d{8,15}$/;
  if (!tel.test(cfg.numeroDirigeant || '')) manque.push('NUMERO_DIRIGEANT (ton portable, format +33…)');
  if (cfg.smsActifs && !tel.test(cfg.numeroSms || '')) manque.push('NUMERO_SMS_TWILIO (SMS_ACTIFS=oui mais pas de numéro)');
  if (cfg.modeAgenda === 'google' && !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(cfg.sheetUrl || '')) {
    manque.push('GOOGLE_SHEET_URL (sinon le journal des appels ne s’écrit pas)');
  }
  if (!cfg.ntfyIdentifiant) manque.push('NTFY_IDENTIFIANT (identifiant n8n « ntfy VorcheX » : sans lui, les alertes ntfy sont refusées)');
  if (!cfg.anthropicIdentifiant) manque.push('ANTHROPIC_IDENTIFIANT (identifiant n8n « Anthropic account » : sans lui, le circuit ne peut pas être activé)');
  return manque;
}

// Champs qui servent à construire le circuit mais ne doivent pas être recopiés dans le code des blocs.
const HORS_CODE = ['cleFinAppel', 'cleFonctions', 'sheetUrl', 'modeAgenda', 'tableRdv', 'tableJournal', 'ntfyIdentifiant', 'anthropicIdentifiant'];

module.exports = { chargerConfig, aRemplir, lireEnv, HORS_CODE };
