// Logique métier du standardiste vocal IA (fiche 1.2), métier : artisan du bâtiment.
// Fonctions pures, sans dépendance : ce même code est recopié dans les blocs « Code » du circuit n8n
// par construire.js, et testé en local par tests/test-logique.js.

const FUSEAU = 'Europe/Paris';
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// --- Heure de Paris -------------------------------------------------------

// Composantes de l'heure de Paris pour un instant donné.
function partiesParis(instant) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = {};
  for (const x of f.formatToParts(instant)) p[x.type] = x.value;
  const jours = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { a: +p.year, m: +p.month, j: +p.day, h: +p.hour, min: +p.minute, js: jours[p.weekday] };
}

// Décalage de Paris (en minutes) par rapport à UTC, à un instant donné.
function decalageParis(instant) {
  const p = partiesParis(instant);
  const commeUtc = Date.UTC(p.a, p.m - 1, p.j, p.h, p.min);
  return Math.round((commeUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

// "2026-11-24T09:00" (heure de Paris) -> objet Date (instant exact). Gère l'heure d'été.
function depuisHeureParis(local) {
  const r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(local || '').trim());
  if (!r) return null;
  const [a, m, j, h, mi] = [+r[1], +r[2], +r[3], +(r[4] || 0), +(r[5] || 0)];
  if (m < 1 || m > 12 || j < 1 || j > 31 || h > 23 || mi > 59) return null;
  const naif = Date.UTC(a, m - 1, j, h, mi);
  let d = new Date(naif - decalageParis(new Date(naif)) * 60000);
  d = new Date(naif - decalageParis(d) * 60000); // deuxième passe autour des changements d'heure
  const verif = partiesParis(d);
  if (verif.j !== j || verif.m !== m) return null; // date impossible (31 février…)
  return d;
}

// Date -> "2026-11-24T09:00:00+01:00" (format accepté par Google Agenda).
function isoParis(instant) {
  const p = partiesParis(instant);
  const dec = decalageParis(instant);
  const s = dec >= 0 ? '+' : '-';
  const z = (n) => String(n).padStart(2, '0');
  return `${p.a}-${z(p.m)}-${z(p.j)}T${z(p.h)}:${z(p.min)}:00${s}${z(Math.floor(Math.abs(dec) / 60))}:${z(Math.abs(dec) % 60)}`;
}

// Date -> "mardi 24 novembre à 9 h" / "à 14 h 30" (pour être lu à voix haute).
function libelleParis(instant) {
  const p = partiesParis(instant);
  const heure = p.min ? `${p.h} h ${String(p.min).padStart(2, '0')}` : `${p.h} h`;
  return `${JOURS[p.js]} ${p.j === 1 ? '1er' : p.j} ${MOIS[p.m - 1]} à ${heure}`;
}

function jourParis(instant) {
  const p = partiesParis(instant);
  return `${p.a}-${String(p.m).padStart(2, '0')}-${String(p.j).padStart(2, '0')}`;
}

function ajouterJours(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

// --- Téléphone ------------------------------------------------------------

// Numéro français dicté -> format international +33…, ou null s'il est invalide.
function normaliserTelephone(brut) {
  if (!brut) return null;
  let t = String(brut).replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (/^0[1-9]\d{8}$/.test(t)) t = '+33' + t.slice(1);
  if (/^33[1-9]\d{8}$/.test(t)) t = '+' + t;
  if (/^\+33[1-9]\d{8}$/.test(t)) return t;
  if (/^\+\d{8,15}$/.test(t) && !t.startsWith('+33')) return t; // numéro étranger : accepté tel quel
  return null;
}

function estMobile(tel) {
  return /^\+33[67]\d{8}$/.test(tel || '');
}

// --- Horaires et créneaux -------------------------------------------------

// Plages d'ouverture d'un jour (heure de Paris), en minutes depuis minuit.
function plagesDuJour(jour, cfg) {
  const d = depuisHeureParis(jour + 'T12:00');
  const js = partiesParis(d).js;
  if ((cfg.joursFermes || []).includes(jour)) return [];
  return (cfg.horaires[js] || []).map(([deb, fin]) => {
    const [h1, m1] = deb.split(':').map(Number);
    const [h2, m2] = fin.split(':').map(Number);
    return [h1 * 60 + m1, h2 * 60 + m2];
  });
}

// Intervalles occupés [debut, fin] (ms) à partir des événements Google Agenda.
function intervallesOccupes(evenements) {
  const res = [];
  for (const e of evenements || []) {
    if (!e || !e.start) continue;
    if (e.status === 'cancelled' || e.transparency === 'transparent') continue;
    let deb, fin;
    if (e.start.dateTime) {
      deb = new Date(e.start.dateTime).getTime();
      fin = new Date((e.end && e.end.dateTime) || e.start.dateTime).getTime();
    } else if (e.start.date) { // journée entière (congés, chantier bloquant…)
      deb = depuisHeureParis(e.start.date + 'T00:00').getTime();
      fin = depuisHeureParis(((e.end && e.end.date) || ajouterJours(e.start.date, 1)) + 'T00:00').getTime();
    } else continue;
    if (fin > deb) res.push([deb, fin]);
  }
  return res;
}

function chevauche(deb, fin, occupes, margeMs) {
  return occupes.some(([d, f]) => deb < f + margeMs && fin + margeMs > d);
}

// Liste des créneaux libres à proposer à l'appelant.
function creneauxLibres(evenements, demande, cfg, maintenant) {
  const occupes = intervallesOccupes(evenements);
  const duree = cfg.dureeRdvMin * 60000;
  const marge = (cfg.margeTrajetMin || 0) * 60000;
  const auPlusTot = maintenant.getTime() + cfg.delaiMinimumH * 3600000;
  const res = [];
  for (let i = 0; i < demande.nbJours && res.length < cfg.nbPropositions; i++) {
    const jour = ajouterJours(demande.jourDebut, i);
    for (const [ouv, ferm] of plagesDuJour(jour, cfg)) {
      for (let t = ouv; t + cfg.dureeRdvMin <= ferm; t += cfg.pasMin) {
        if (demande.partie === 'matin' && t >= 12 * 60) continue;
        if (demande.partie === 'apres-midi' && t < 12 * 60) continue;
        const hh = String(Math.floor(t / 60)).padStart(2, '0');
        const mm = String(t % 60).padStart(2, '0');
        const deb = depuisHeureParis(`${jour}T${hh}:${mm}`).getTime();
        if (deb < auPlusTot) continue;
        if (chevauche(deb, deb + duree, occupes, marge)) continue;
        res.push(new Date(deb));
        break; // un seul créneau par plage (matin / après-midi) : des choix variés à l'oral
      }
      if (res.length >= cfg.nbPropositions) break;
    }
  }
  return res.slice(0, cfg.nbPropositions).map((d) => ({
    debut: isoParis(d).slice(0, 16),
    libelle: libelleParis(d),
  }));
}

// "jeudi 19 novembre" (sans l'heure).
function jourLibelle(instant) {
  const p = partiesParis(instant);
  return `${JOURS[p.js]} ${p.j === 1 ? '1er' : p.j} ${MOIS[p.m - 1]}`;
}

// "14 h" / "14 h 30".
function heureLibelle(instant) {
  const p = partiesParis(instant);
  return p.min ? `${p.h} h ${String(p.min).padStart(2, '0')}` : `${p.h} h`;
}

// Texte de date : ISO avec fuseau ("…+01:00", "…Z") ou heure de Paris sans fuseau ("2026-11-19 17:54").
function lireDate(texte) {
  const s = String(texte || '').trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  return depuisHeureParis(s.replace(' ', 'T'));
}

// --- Rendez-vous : lignes de la table n8n ou événements Google -> même forme ---

// Une ligne (debut/fin) ou un événement Google -> événement { start, end } pour le calcul d'occupation.
function versEvenement(e) {
  if (!e) return null;
  if (e.start) return e;
  if (e.debut) return { id: e.id, start: { dateTime: e.debut }, end: { dateTime: e.fin || e.debut } };
  return null;
}

// Une ligne ou un événement -> { id, idBrut, debut, fin, nom, telephone, adresse, motif } (null si inexploitable).
function versRdv(e) {
  if (!e) return null;
  if (e.debut) {
    return {
      id: String(e.id), idBrut: e.id, debut: e.debut, fin: e.fin || e.debut, nom: e.nom || '',
      telephone: e.telephone || '', adresse: e.adresse || '', motif: e.motif || '',
    };
  }
  if (e.start && e.start.dateTime) { // événement créé par le circuit (description structurée)
    const desc = String(e.description || '');
    const champ = (nom) => ((new RegExp(nom + ' : (.*)')).exec(desc) || [])[1] || '';
    return {
      id: String(e.id), idBrut: e.id, debut: e.start.dateTime, fin: (e.end && e.end.dateTime) || e.start.dateTime,
      nom: champ('Client') || e.summary || '', telephone: champ('Téléphone').trim(),
      adresse: e.location || '', motif: champ('Motif'),
    };
  }
  return null;
}

// Rendez-vous à venir d'un client, retrouvés par son numéro.
function rdvDuClient(elements, telephone, maintenant) {
  return (elements || []).map(versRdv)
    .filter((r) => r && r.telephone === telephone && lireDate(r.debut) && lireDate(r.debut) > maintenant)
    .sort((a, b) => lireDate(a.debut) - lireDate(b.debut))
    .map((r) => ({ id: r.id, debut: r.debut, libelle: libelleParis(lireDate(r.debut)), adresse: r.adresse, motif: r.motif }));
}

function messageRdvTrouves(liste) {
  if (!liste.length) {
    return {
      resultat: "Aucun rendez-vous à venir pour ce numéro. Vérifie le numéro avec l'appelant ; sinon propose que le dirigeant le rappelle.",
      rendez_vous: [],
    };
  }
  return {
    resultat: `Rendez-vous trouvé${liste.length > 1 ? 's' : ''} : ${liste.map((r) => `${r.libelle} au ${r.adresse}`).join(' ; ')}. `
      + "Fais confirmer lequel, puis demande s'il veut l'annuler ou le déplacer. Ne lis jamais les identifiants à voix haute.",
    rendez_vous: liste,
  };
}

// Vérifie qu'une annulation ou un déplacement est permis, et prépare la suite.
// modif = { id, telephone } (+ debut, fin, libelle pour un déplacement).
function controlerModification(elements, modif, cfg, maintenant) {
  const refus = (resultat) => ({ ok: false, resultat });
  const cible = (elements || []).map(versRdv).find((r) => r && r.id === String(modif.id));
  if (!cible || cible.telephone !== modif.telephone) {
    return refus("Je ne trouve pas ce rendez-vous pour ce numéro. Relance trouver_rdv avec le numéro donné lors de la réservation.");
  }
  const debutActuel = lireDate(cible.debut);
  if (!debutActuel || debutActuel <= maintenant) return refus("Ce rendez-vous est déjà passé : il ne peut plus être modifié. Propose que le dirigeant rappelle.");
  const ancien = { ...cible, libelle: libelleParis(debutActuel) };
  const qui = `${cible.nom || 'Client'} (${cible.telephone})`;
  if (!modif.debut) {
    return {
      ok: true, action: 'annuler', id: cible.idBrut, ancien,
      resultat: `Rendez-vous du ${ancien.libelle} annulé. Confirme-le à l'appelant et demande s'il souhaite un autre créneau.`,
      alerte: `Annulé : ${qui} — ${ancien.libelle}, ${cible.adresse}`,
    };
  }
  const deb = lireDate(modif.debut);
  const fin = lireDate(modif.fin);
  const autres = (elements || []).filter((e) => e && String(e.id) !== cible.id).map(versEvenement).filter(Boolean);
  if (chevauche(deb.getTime(), fin.getTime(), intervallesOccupes(autres), (cfg.margeTrajetMin || 0) * 60000)) {
    return refus("Ce nouveau créneau n'est plus libre. Excuse-toi, vérifie de nouveau les créneaux et propose les suivants.");
  }
  return {
    ok: true, action: 'deplacer', id: cible.idBrut, ancien,
    nouveau: { debut: isoParis(deb), fin: isoParis(fin), libelle: libelleParis(deb) },
    telephone: cible.telephone, mobile: estMobile(cible.telephone),
    resultat: `Rendez-vous déplacé au ${libelleParis(deb)}, au ${cible.adresse}. Confirme-le à l'appelant.`,
    alerte: `Déplacé : ${qui} — ${ancien.libelle} -> ${libelleParis(deb)}, ${cible.adresse}`,
    sms: `${cfg.nomEntreprise} : votre RDV est déplacé au ${libelleParis(deb)} au ${cible.adresse}. Pour toute question, appelez le ${cfg.numeroAffiche}.`,
  };
}

// --- Lien photo -------------------------------------------------------------

// Empreinte courte (FNV-1a, deux passes). Pas de la cryptographie : elle empêche seulement de fabriquer
// un lien valide sans connaître la clé (ex. en changeant le numéro de rendez-vous dans l'adresse).
function signature(texte, cle) {
  const fnv = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
  const a = fnv(`${cle}|${texte}`);
  const b = fnv(`${texte}|${cle}|${a}`);
  return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0');
}

function lienPhoto(cfg, ref, cle) {
  return `${cfg.urlFormPhoto}?ref=${encodeURIComponent(String(ref))}&k=${signature(String(ref), cle)}`;
}

function lienPhotoValide(ref, k, cle) {
  return !!ref && !!k && signature(String(ref), cle) === String(k);
}

// --- Récapitulatif du soir et rappels de la veille ---------------------------

// lignes : journal des appels ; elementsRdv : rendez-vous (table ou Google). Envoyé à 19 h, du dimanche au vendredi.
function recapitulatif(lignes, elementsRdv, cfg, maintenant) {
  const p = partiesParis(maintenant);
  const reculH = p.js === 0 ? 48 : 24; // le dimanche : depuis vendredi soir
  const depuis = maintenant.getTime() - reculH * 3600000;
  const appels = (lignes || []).filter((l) => {
    const d = l && lireDate(l.date);
    return d && d.getTime() > depuis && d <= maintenant;
  });
  const demain = ajouterJours(jourParis(maintenant), 1);
  const rdvs = (elementsRdv || []).map(versRdv)
    .filter((r) => r && lireDate(r.debut) && jourParis(lireDate(r.debut)) === demain)
    .sort((a, b) => lireDate(a.debut) - lireDate(b.debut));
  const nbRdv = appels.filter((l) => l.rdv_pris === 'oui').length;
  const nbUrg = appels.filter((l) => l.urgent === 'oui').length;
  const aRappeler = appels.filter((l) => l.rdv_pris !== 'oui' && l.suite && !/^aucun/i.test(l.suite.trim()));
  const jourDemain = jourLibelle(depuisHeureParis(demain + 'T12:00'));
  const s = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  const lignesMsg = [
    `${s(appels.length, 'appel')} ${reculH === 48 ? 'depuis vendredi 19 h' : 'depuis hier 19 h'} · ${nbRdv} RDV pris · ${s(nbUrg, 'urgence')}`,
  ];
  if (aRappeler.length) {
    lignesMsg.push('', 'À rappeler :');
    for (const l of aRappeler.slice(0, 8)) lignesMsg.push(`• ${l.nom || 'Inconnu'}${l.numero ? ' ' + l.numero : ''} : ${l.suite}`);
    if (aRappeler.length > 8) lignesMsg.push(`• … et ${aRappeler.length - 8} autre(s) dans le journal`);
  }
  lignesMsg.push('', `Demain, ${jourDemain} :`);
  if (!rdvs.length) lignesMsg.push('Aucun rendez-vous.');
  for (const r of rdvs) {
    lignesMsg.push(`• ${heureLibelle(lireDate(r.debut))} ${r.nom || 'Client'} – ${r.adresse || 'adresse ?'} – ${r.motif || 'motif ?'}${r.telephone ? ' – ' + r.telephone : ''}`);
  }
  const rappels = rdvs.filter((r) => estMobile(r.telephone)).map((r) => ({
    telephone: r.telephone,
    sms: `${cfg.nomEntreprise} : rappel de votre RDV demain à ${heureLibelle(lireDate(r.debut))} au ${r.adresse}. `
      + `Pour annuler ou déplacer, appelez le ${cfg.numeroAffiche}.`,
  }));
  return {
    titre: `${cfg.nomEntreprise} · récap du ${jourLibelle(maintenant)}`,
    message: lignesMsg.join('\n'),
    nbAppels: appels.length, nbRdv, nbUrgences: nbUrg, nbDemain: rdvs.length, rappels,
  };
}

// --- Conservation limitée des données (RGPD) ----------------------------------

// Identifiants des lignes plus anciennes que « jours » (champ de date au choix).
function lignesAPurger(lignes, champ, jours, maintenant) {
  const limite = maintenant.getTime() - jours * 86400000;
  return (lignes || []).filter((l) => {
    const d = l && l.id !== undefined && lireDate(l[champ]);
    return d && d.getTime() < limite;
  }).map((l) => ({ id: l.id }));
}

// --- Contrôle des demandes de l'agent vocal -------------------------------

const ROUTES = { verifier_creneaux: 0, reserver_rdv: 1, signaler_urgence: 2, trouver_rdv: 4, annuler_rdv: 5, deplacer_rdv: 6 };

// Vérifie un créneau demandé (texte "AAAA-MM-JJTHH:MM") : { deb, fin } ou { erreur }.
function validerCreneau(texte, cfg, maintenant) {
  const deb = depuisHeureParis(texte);
  if (!deb) return { erreur: 'Heure de rendez-vous non comprise. Repropose un des créneaux donnés.' };
  if (deb.getTime() < maintenant.getTime() + cfg.delaiMinimumH * 3600000) {
    return { erreur: 'Ce créneau est trop proche ou déjà passé. Vérifie de nouveau les créneaux.' };
  }
  const p = partiesParis(deb);
  const minutes = p.h * 60 + p.min;
  const ok = plagesDuJour(jourParis(deb), cfg).some(([o, f]) => minutes >= o && minutes + cfg.dureeRdvMin <= f);
  if (!ok) return { erreur: "Ce créneau est en dehors des horaires d'intervention. Vérifie de nouveau les créneaux." };
  return { deb, fin: new Date(deb.getTime() + cfg.dureeRdvMin * 60000) };
}

// Vérifie la requête envoyée par Retell ({ name, args, call }) et prépare la suite.
// Renvoie toujours un objet ; en cas d'erreur, route = 3 et « resultat » explique quoi redemander.
function preparerDemande(corps, cfg, maintenant) {
  const nom = corps && corps.name;
  const args = (corps && corps.args) || {};
  const appel = (corps && corps.call) || {};
  const base = { action: nom, cfg, appelId: appel.call_id || null, numeroAppelant: appel.from_number || null };
  const erreur = (msg) => ({ ...base, route: 3, resultat: msg });

  if (!(nom in ROUTES)) return erreur(`Fonction inconnue : ${nom || 'aucune'}. Propose à l'appelant d'être rappelé.`);

  if (nom === 'verifier_creneaux') {
    let jourDebut = ajouterJours(jourParis(maintenant), 1);
    if (args.date) {
      const d = depuisHeureParis(args.date);
      if (!d) return erreur('Date non comprise. Redemande le jour souhaité.');
      const j = jourParis(d);
      if (j > jourDebut) jourDebut = j;
      else if (j === jourParis(maintenant)) jourDebut = j; // aujourd'hui : le délai minimum filtrera
    }
    const partie = ['matin', 'apres-midi'].includes(args.partie_journee) ? args.partie_journee : 'indifferent';
    const nbJours = cfg.horizonJours;
    const fin = ajouterJours(jourDebut, nbJours);
    return {
      ...base, route: 0, demande: { jourDebut, nbJours, partie },
      timeMin: isoParis(depuisHeureParis(jourDebut + 'T00:00')),
      timeMax: isoParis(depuisHeureParis(fin + 'T00:00')),
    };
  }

  // Recherche, annulation, déplacement : fenêtre de lecture de l'agenda à partir de maintenant.
  const fenetre = {
    timeMin: isoParis(maintenant),
    timeMax: isoParis(new Date(maintenant.getTime() + (cfg.horizonRechercheJours || 90) * 86400000)),
  };
  const telClient = normaliserTelephone(args.telephone) || normaliserTelephone(base.numeroAppelant);

  if (nom === 'trouver_rdv') {
    if (!telClient) return erreur('Demande le numéro de téléphone donné lors de la réservation, chiffre par chiffre.');
    return { ...base, route: 4, recherche: { telephone: telClient }, ...fenetre };
  }

  if (nom === 'annuler_rdv' || nom === 'deplacer_rdv') {
    if (!String(args.id || '').trim()) return erreur("Identifiant du rendez-vous manquant : appelle d'abord trouver_rdv.");
    if (!telClient) return erreur('Demande le numéro de téléphone donné lors de la réservation, chiffre par chiffre.');
    const modif = { id: String(args.id).trim(), telephone: telClient };
    if (nom === 'annuler_rdv') return { ...base, route: 5, modif, ...fenetre };
    if (!String(args.debut || '').trim()) return erreur("Nouveau créneau manquant : appelle verifier_creneaux, fais choisir, puis redonne la valeur debut.");
    const c = validerCreneau(args.debut, cfg, maintenant);
    if (c.erreur) return erreur(c.erreur);
    return {
      ...base, route: 6, ...fenetre,
      modif: { ...modif, debut: isoParis(c.deb), fin: isoParis(c.fin), libelle: libelleParis(c.deb) },
    };
  }

  if (nom === 'reserver_rdv') {
    const manque = ['nom', 'telephone', 'adresse', 'motif', 'debut'].filter((k) => !String(args[k] || '').trim());
    if (manque.length) return erreur(`Il manque : ${manque.join(', ')}. Redemande-le avant de réserver.`);
    const tel = telClient;
    if (!tel) return erreur('Numéro de téléphone invalide. Redemande-le chiffre par chiffre.');
    const c = validerCreneau(args.debut, cfg, maintenant);
    if (c.erreur) return erreur(c.erreur);
    const { deb, fin } = c;
    const propre = (s, n) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);
    return {
      ...base, route: 1,
      rdv: {
        nom: propre(args.nom, 80), telephone: tel, mobile: estMobile(tel),
        adresse: propre(args.adresse, 200), motif: propre(args.motif, 300),
        debut: isoParis(deb), fin: isoParis(fin), libelle: libelleParis(deb),
        // fenêtre à relire dans l'agenda juste avant de réserver (marge de trajet incluse)
        controleMin: isoParis(new Date(deb.getTime() - (cfg.margeTrajetMin || 0) * 60000)),
        controleMax: isoParis(new Date(fin.getTime() + (cfg.margeTrajetMin || 0) * 60000)),
      },
    };
  }

  // signaler_urgence
  const tel = normaliserTelephone(args.telephone) || normaliserTelephone(base.numeroAppelant);
  if (!String(args.description || '').trim()) return erreur("Décris l'urgence en une phrase avant de la signaler.");
  return {
    ...base, route: 2,
    urgence: {
      nom: String(args.nom || 'inconnu').trim(), telephone: tel || 'non communiqué',
      adresse: String(args.adresse || 'non communiquée').trim(), description: String(args.description).trim(),
    },
  };
}

// --- Messages ----------------------------------------------------------------

function messageCreneaux(creneaux) {
  if (!creneaux.length) {
    return { resultat: "Aucun créneau libre sur la période. Propose qu'on le rappelle pour fixer une date.", creneaux: [] };
  }
  return {
    resultat: `Créneaux libres : ${creneaux.map((c) => c.libelle).join(' ; ')}. Propose-les et demande lequel convient.`,
    creneaux,
  };
}

function smsConfirmation(rdv, cfg, lien) {
  return `${cfg.nomEntreprise} : RDV confirmé ${rdv.libelle} au ${rdv.adresse}. `
    + (lien ? `Envoyez-nous une photo du problème : ${lien} . ` : '')
    + `Pour annuler ou déplacer, appelez le ${cfg.numeroAffiche}.`;
}

function alerteUrgence(u, cfg) {
  return `URGENCE ${cfg.nomEntreprise} - ${u.description} - ${u.nom}, ${u.telephone}, ${u.adresse}`;
}

// Ligne du journal des appels (une ligne par appel, base du rapport mensuel).
function ligneJournal(appel, extraction) {
  const debut = appel.start_timestamp ? new Date(appel.start_timestamp) : null;
  const duree = appel.start_timestamp && appel.end_timestamp
    ? Math.round((appel.end_timestamp - appel.start_timestamp) / 1000) : null;
  const x = extraction || {};
  return {
    date: debut ? isoParis(debut).slice(0, 16).replace('T', ' ') : '',
    appel_id: appel.call_id || '',
    numero: appel.from_number || '',
    duree_s: duree,
    motif: x.motif || 'autre',
    urgent: x.urgent ? 'oui' : 'non',
    rdv_pris: x.rendez_vous_pris ? 'oui' : 'non',
    nom: x.nom || '',
    adresse: x.adresse || '',
    suite: x.suite_a_donner || '',
    resume: x.resume || '',
    fin_appel: appel.disconnection_reason || '',
  };
}

module.exports = {
  partiesParis, decalageParis, depuisHeureParis, isoParis, libelleParis, jourParis, ajouterJours,
  jourLibelle, heureLibelle, lireDate,
  normaliserTelephone, estMobile, plagesDuJour, intervallesOccupes, chevauche, creneauxLibres,
  versEvenement, versRdv, rdvDuClient, messageRdvTrouves, controlerModification,
  signature, lienPhoto, lienPhotoValide, recapitulatif, lignesAPurger, validerCreneau,
  preparerDemande, messageCreneaux, smsConfirmation, alerteUrgence, ligneJournal,
};
