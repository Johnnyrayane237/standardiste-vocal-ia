# Guide de branchement — 1.2 Standardiste vocal IA (Plomberie Garnier, démo VorcheX)

Mis à jour le 20 novembre 2026. État : **branché et validé de bout en bout** (appels vocaux, prise, déplacement et annulation de rendez-vous, urgence, journal des appels, photo, récap du soir, purge nocturne, alertes ntfy).

## Vue d'ensemble

```
Appelant ──► Retell (agent « Lucie ») ──► n8n « vx-batiment-fonctions »  (pendant l'appel)
                    │                         ├─ verifier_creneaux → lit la table Rendez-vous
                    │                         ├─ reserver_rdv      → écrit dans la table Rendez-vous (+ lien photo signé)
                    │                         ├─ trouver_rdv       → retrouve les rendez-vous à venir du numéro
                    │                         ├─ deplacer_rdv      → change l'heure (+ alerte ntfy, + SMS si activé)
                    │                         ├─ annuler_rdv       → efface le rendez-vous (+ alerte ntfy)
                    │                         └─ signaler_urgence  → alerte ntfy (+ SMS si activé)
                    │
                    └─ fin d'appel (call_analyzed) ──► n8n « vx-batiment-fin-appel »
                                                         → résumé par Claude → table Journal des appels

Client ──► formulaire /form/vx-batiment-photo (lien signé) ──► photo au dirigeant (ntfy)
19 h (dim.–ven.) ──► récap au dirigeant (ntfy) + SMS de rappel la veille (si activé)
3 h chaque nuit  ──► purge : journal > 365 jours, rendez-vous terminés depuis > 90 jours
```

## Ce qui est en place

| Élément | Où | Détail |
|---|---|---|
| Circuit n8n | `https://n8n.vorchex.tech`, id `VOrYLd8QDLI6mPxv` | **Actif**, 60 blocs. Un seul circuit : toujours le mettre à jour, jamais le dupliquer. |
| Agenda de démo | Table n8n « Démo Garnier · Rendez-vous » (id dans `.env` : `TABLE_RDV`) | Remplace Google Agenda (`MODE_AGENDA=demo`). |
| Journal de démo | Table n8n « Démo Garnier · Journal des appels » (id dans `.env` : `TABLE_JOURNAL`) | Remplace Google Sheets. |
| Identifiant n8n Anthropic | « Anthropic account », id dans `.env` (`ANTHROPIC_IDENTIFIANT`) | Indispensable : sans lui, n8n refuse d'activer le circuit. |
| Identifiant n8n ntfy | Type *Bearer Auth*, id dans `.env` (`NTFY_IDENTIFIANT`) | Branché le 20/11/2026, avec le jeton d'un compte ntfy administrateur. Sans lui, ntfy répond « 403 ». |
| Résumé de fin d'appel | Bloc « Claude (Résumé et motif) » | Modèle `claude-haiku-5-5` depuis le 19/11/2026. |
| SMS | Blocs Twilio grisés | `SMS_ACTIFS=non`. L'agent ne promet pas de SMS. |
| Agent Retell | « Lucie · Plomberie Garnier (VorcheX) », espace VorcheX | Version publiée : **V2 « RGPD + déplacer/annuler »** (20/11/2026). Retell numérote à partir de V0. |

## Réglages de l'agent Retell

- **Modèle** : GPT 5.6 Terra. **Langue** : français (France). **Voix** : ElevenLabs « Lucie - Support Agent ».
- **Consignes** : contenu de [agent-retell/consignes.md](agent-retell/consignes.md).
- **Message d'accueil** : « Plomberie Garnier, bonjour ! Je suis Lucie, l'assistante virtuelle. Cet appel est enregistré pour le suivi de votre demande. Que puis-je faire pour vous ? »
- **Fonctions** :
  - `end_call` : raccrocher.
  - `verifier_creneaux`, `reserver_rdv`, `signaler_urgence`, `trouver_rdv`, `annuler_rdv`, `deplacer_rdv` : fonctions personnalisées en POST, « Wait for completion » + « Talk while waiting » en **Static Sentence**, délai 120 s. Adresse commune : `https://n8n.vorchex.tech/webhook/vx-batiment-fonctions?cle={{cle_fonctions}}`. Descriptions, schémas JSON et phrases d'attente : [agent-retell/fonctions.json](agent-retell/fonctions.json).
  - `transfer_call` : transfert vers le portable du dirigeant. **Ne fonctionne pas en appel web**, seulement sur un vrai numéro.
- **Webhook de l'agent** (« Webhook settings ») : `https://n8n.vorchex.tech/webhook/vx-batiment-fin-appel?cle=` suivi de la **valeur réelle** de `CLE_FIN_APPEL`, collée à la main. Événement **Call analyzed** uniquement.
  - ⚠️ Retell ne remplace **pas** les variables `{{…}}` dans l'adresse du webhook de l'agent. Il faut la clé en clair.
- **Clé des fonctions** (« Security & fallback settings » → « Default Dynamic Variables ») : `cle_fonctions` = valeur de `CLE_FONCTIONS` dans `.env`. Ici, la variable est bien remplacée.
- **Données (RGPD)**, dans « Security & fallback settings » :
  - « Data Storage Settings » : *Everything*, **Retention : 30 days**. Retell efface enregistrements et transcriptions au bout de 30 jours.
  - « Opt In Secure URLs » : **activé** (liens d'enregistrement signés, valables 24 h).

Une requête sans la bonne clé reçoit « Accès refusé. » et n'écrit rien.

## Déplacer ou annuler un rendez-vous

1. L'agent appelle `trouver_rdv` avec le numéro donné à la réservation (ou celui de l'appelant sur un vrai appel). Seuls les rendez-vous **à venir** de ce numéro sont rendus.
2. Il fait confirmer lequel, puis :
   - annulation : `annuler_rdv` (id) seulement après un « oui » clair ;
   - déplacement : `verifier_creneaux`, choix de l'appelant, puis `deplacer_rdv` (id + nouveau `debut`).
3. n8n revérifie que le rendez-vous appartient bien à ce numéro et n'est pas passé, puis prévient le dirigeant (ntfy).

## Photo du problème

- À chaque réservation, n8n fabrique un lien `https://n8n.vorchex.tech/form/vx-batiment-photo?ref=<id>&k=<signature>`. La signature empêche d'envoyer une photo sur le rendez-vous de quelqu'un d'autre en changeant l'id.
- Le lien part dans le SMS de confirmation (si les SMS sont activés). Le client choisit une photo, n8n la transmet au dirigeant par ntfy avec le nom, l'heure et l'adresse.
- Dans n8n 2.46, le chemin du formulaire se règle dans `options.path` du bloc « Photo du client » (sinon : « Problem loading form »).

## Récap du soir et purge

- **19 h, du dimanche au vendredi** : récapitulatif au dirigeant (appels du jour, rendez-vous pris, urgences, personnes à rappeler, rendez-vous du lendemain). Le dimanche, il couvre depuis vendredi soir. Les SMS de rappel de la veille partent en même temps si `SMS_ACTIFS=oui`.
- **3 h chaque nuit** : effacement des lignes du journal de plus de 365 jours et des rendez-vous terminés depuis plus de 90 jours (`conservationJournalJours`, `conservationRdvJours` dans `config-client.json`).
- Pour lancer l'un ou l'autre à la main : `POST /rest/workflows/VOrYLd8QDLI6mPxv/run` avec `{ workflowData, triggerToStartFrom: { name: "Récap du soir (19 h)" } }` (ou « Purge nocturne (3 h) »).

## Mention RGPD (brouillon à adapter avec le client)

> Vos appels à Plomberie Garnier peuvent être pris par une assistante virtuelle. Ils sont enregistrés et transcrits pour traiter votre demande (prise de rendez-vous, urgence, rappel). Enregistrements et transcriptions sont conservés 30 jours ; le résumé de l'appel est gardé au plus un an dans notre journal, les rendez-vous 90 jours après l'intervention. Vous pouvez demander l'accès à vos données ou leur effacement en appelant le 04 xx xx xx xx ou par courriel à contact@…. Sous-traitants : Retell AI (téléphonie et voix), ElevenLabs (voix), Anthropic (résumé), hébergement n8n VorcheX.

À relire avec le client : ses coordonnées, la base légale (exécution d'un contrat ou mesures précontractuelles), et la mention dans ses conditions et sur son site.

## Essais réalisés

| Date | Essai | Résultat |
|---|---|---|
| 19/11 | Mauvaise clé | Refusé (« Accès refusé. »). |
| 19/11 | Prise de rendez-vous, même créneau redemandé, urgence | OK : pas de double réservation ; `signaler_urgence` puis `transfer_call`. |
| 19/11 | 3 appels vocaux (web) | Rendez-vous OK ; journal écrit après correction du webhook et de la clé Anthropic. |
| 19–20/11 | Circuit n8n seul : réservation avec lien photo, trouver, déplacer, annuler (y compris refus avec un autre numéro), formulaire photo (lien signé accepté, lien trafiqué refusé), récap, purge | Tous réussis. ntfy : 403 (identifiant à créer). |
| 20/11 | Conversation écrite Retell : réserver (lun. 23/11 8 h) → déplacer (mar. 24/11 8 h) → annuler | Les 6 fonctions appelées au bon moment, 7 exécutions n8n réussies, table vide à la fin. Une fois, l'agent a dit « Je retrouve votre rendez-vous » sans lancer la fonction ; il l'a lancée à la relance suivante. À surveiller lors d'un essai vocal. |
| 20/11 | Récap du soir automatique (19 h) | Exécution réussie. |
| 20/11 | Identifiant ntfy branché, récap lancé à la main | ntfy accepte le message sur `garnier-urgences`. |

Dans le journal, la colonne `numero` reste vide pour un appel web : Retell ne transmet un numéro que pour un vrai appel téléphonique.

En cas d'échec d'une fin d'appel (par exemple identifiant expiré), corriger la cause puis relancer l'exécution en échec depuis n8n (« Executions » → « Retry ») : pas besoin de refaire l'appel.

## Faire l'appel vocal d'essai

1. Dans Retell, sur la page de l'agent, onglet **Test Audio** à droite, clique sur **Run Test** et autorise le micro.
2. Demande un rendez-vous (problème, adresse, nom, numéro), choisis un créneau. Tu peux ensuite demander à le déplacer, puis à l'annuler.
3. Une à deux minutes après la fin de l'appel, vérifie dans n8n :
   - une nouvelle exécution réussie du webhook « fin d'appel » ;
   - une ligne dans la table « Journal des appels », avec le résumé écrit par Claude.

Pour un essai écrit : onglet **Test LLM**, bouton **New** puis **Manual Chat** (le bouton « rafraîchir » rejoue toute l'ancienne conversation).

## ntfy (branché le 20 novembre 2026)

- Jeton créé **sans mot de passe** dans le terminal du service ntfy (Coolify) : `ntfy token add <compte>`. Pour voir les comptes : `ntfy user list`. Pour changer un mot de passe oublié : `ntfy user change-pass <compte>`. Pour révoquer un jeton : `ntfy token remove <compte> <jeton>`.
- Les détails propres à cette installation (ids, compte, numéros) sont dans `NOTES-PRIVEES.md`, qui n'est pas publié.
- Jeton collé dans un identifiant n8n de type **Bearer Auth**, dont l'id est dans `.env` (`NTFY_IDENTIFIANT`).
- Pour que le téléphone sonne : dans l'application ntfy (Android), s'abonner au sujet `garnier-urgences` sur le serveur `alertes.vorchex.tech` (en plus de `rhonda`).
- Pour un vrai client : un sujet à son nom et un jeton par client.

## Modifier quelque chose

- **Logique ou réglages du circuit** : modifier `logique/logique.js`, `config-client.json` ou `.env`, puis `node construire.js` (il signale ce qui manque, par exemple `ANTHROPIC_IDENTIFIANT` ou `NTFY_IDENTIFIANT`), relancer les deux tests (`node tests/test-logique.js` : 34 essais, `node tests/test-circuit.js` : 31 essais), puis mettre à jour le circuit **existant** dans n8n (même id) et activer la nouvelle version (`POST /rest/workflows/:id/activate` avec `versionId`).
- **Consignes de l'agent** : modifier `agent-retell/consignes.md`, recopier le texte dans Retell, puis **Publish**.
- **Clés** : si `CLE_FONCTIONS` change, la recopier dans les « Default Dynamic Variables » de Retell ; si `CLE_FIN_APPEL` change, la recopier à la fin de l'adresse du webhook. La clé des fonctions sert aussi à signer les liens photo : la changer rend les anciens liens invalides. Republier l'agent après chaque changement.

## Passer d'une démo à un vrai client

1. `MODE_AGENDA=google` + `AGENDA_ID` et `GOOGLE_SHEET_URL` du client, identifiants Google dans n8n. La purge nocturne ne fonctionne qu'en mode démo : en mode Google, prévoir la purge de l'agenda et du tableur.
2. `SMS_ACTIFS=oui` une fois l'identifiant Twilio créé dans n8n. Vérifier le numéro du dirigeant chez Twilio : il a été enregistré avec un 0 en trop (+330…).
3. Acheter ou importer un numéro dans Retell et l'attacher à l'agent : c'est seulement là que le transfert d'appel fonctionne, et que `trouver_rdv` peut utiliser le numéro de l'appelant sans le lui demander.
4. Remplacer le nom, les horaires et le numéro du dirigeant dans les consignes et la fonction `transfer_call`.
5. Finaliser la mention RGPD avec le client et la mettre sur son site.
