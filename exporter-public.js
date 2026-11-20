// Fabrique une copie publiable du circuit n8n : chaque valeur privée du .env (clés, numéros, ids)
// est remplacée par un repère {{NOM_DE_LA_VARIABLE}}. À lancer après `node construire.js`.
// Le fichier construit (n8n/1.2-standardiste-vocal-batiment.n8n.json) reste privé : il est dans .gitignore.
const fs = require('fs');
const path = require('path');
const { lireEnv } = require('./charger-config');

const ici = __dirname;
const source = path.join(ici, 'n8n', '1.2-standardiste-vocal-batiment.n8n.json');
const cible = path.join(ici, 'n8n', 'modele-public.n8n.json');

const PRIVEES = [
  'CLE_FIN_APPEL', 'CLE_FONCTIONS', 'NUMERO_DIRIGEANT', 'NUMERO_SMS_TWILIO', 'GOOGLE_SHEET_URL',
  'AGENDA_ID', 'TABLE_RDV', 'TABLE_JOURNAL', 'NTFY_IDENTIFIANT', 'ANTHROPIC_IDENTIFIANT',
];

const env = lireEnv(path.join(ici, '.env'));
let texte = fs.readFileSync(source, 'utf8');

// Les plus longues d'abord, pour qu'une valeur courte ne coupe pas une valeur plus longue.
const valeurs = PRIVEES
  .map((cle) => [cle, env[cle]])
  .filter(([, v]) => v && v.length >= 6 && v !== 'primary')
  .sort((a, b) => b[1].length - a[1].length);

for (const [cle, valeur] of valeurs) {
  texte = texte.split(valeur).join(`{{${cle}}}`);
  // Les numéros apparaissent aussi sans le « + » ou avec des espaces dans certains messages.
  if (/^\+\d+$/.test(valeur)) texte = texte.split(valeur.slice(1)).join(`{{${cle}}}`);
}

const restes = valeurs.filter(([, v]) => texte.includes(v)).map(([cle]) => cle);
if (restes.length) {
  console.error('Arrêt : valeurs privées encore présentes :', restes.join(', '));
  process.exit(1);
}

JSON.parse(texte); // le résultat doit rester un JSON valide
fs.writeFileSync(cible, texte);
console.log(`${valeurs.length} valeurs privées masquées dans ${path.relative(ici, cible)}`);
