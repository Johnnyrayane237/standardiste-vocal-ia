# Standardiste vocal IA pour artisan du bâtiment

**Un projet de Johanne Pamegne** — automatisation et agents IA · [Portfolio](https://johanne.vorchex.tech) · [LinkedIn](https://www.linkedin.com/in/johanne-pamegne-2672b63b4)

Une assistante téléphonique qui décroche quand l'artisan est sur un chantier. Elle prend, déplace et annule les rendez-vous, repère les urgences et prévient le patron. Chaque soir, elle lui envoie un récapitulatif de la journée.

Démonstration réalisée sous ma marque **VorcheX** pour une entreprise **fictive**, *Plomberie Garnier*. Tout a été testé de bout en bout les 19 et 20 novembre 2026 : appels vocaux, conversations écrites et exécutions réelles du circuit n8n.

## Le problème de départ

Un plombier sur un chantier ne peut pas décrocher. Chaque appel manqué peut être un client perdu, et une vraie urgence (fuite, plus de chauffage) peut attendre des heures. Je voulais une réponse **utile dès le premier appel**, sans changer les habitudes de l'artisan : il garde son téléphone, et l'assistante lui envoie seulement ce qui demande son attention.

## Mon rôle

J'ai conçu et piloté le projet de bout en bout :
- le parcours d'appel et le choix des outils ;
- les règles métier (horaires, délais, urgences) ;
- la sécurité et la conformité RGPD ;
- les essais réels et le déploiement sur mon propre serveur (n8n et ntfy auto-hébergés via Coolify).

Le code a été écrit avec **Claude Code**, que j'ai dirigé étape par étape : je fixais les objectifs et les contraintes, je relisais, je testais et je décidais. Savoir faire travailler une IA de façon fiable, avec des tests, des vérifications et aucun secret exposé, fait partie de ce que je veux montrer ici.

## Ce que fait « Lucie »

| Situation | Ce qui se passe |
|---|---|
| Un client veut un rendez-vous | Lucie lit les créneaux **réellement libres** (horaires, trajets, délai minimum), en propose trois, réserve celui qui est choisi et confirme le jour, l'heure et l'adresse. Un même créneau ne peut pas être pris deux fois. |
| Un client veut déplacer ou annuler | Lucie retrouve ses rendez-vous à venir grâce à son numéro, fait confirmer lequel, puis le déplace vers un créneau libre ou l'annule. Le serveur revérifie que le rendez-vous appartient bien à ce numéro. |
| Une urgence (fuite, plus de chauffage, odeur de gaz…) | Consignes de sécurité si besoin, alerte immédiate sur le téléphone du patron, puis transfert de l'appel. |
| Toute autre demande | Notée pour que le patron rappelle. |
| Fin de l'appel | Claude résume l'appel, classe le motif et note la suite à donner dans le journal. |
| Photo du problème | Chaque rendez-vous a un lien de formulaire **signé** : le client envoie une photo, elle arrive sur le téléphone du patron. |
| 19 h, du dimanche au vendredi | Récapitulatif au patron : appels, rendez-vous, urgences, personnes à rappeler, rendez-vous du lendemain. Rappels SMS aux clients du lendemain (en option). |
| 3 h chaque nuit | Effacement automatique des données trop anciennes (RGPD). |

## Architecture

```
Appelant ──► Retell AI (agent vocal, voix ElevenLabs)
                │  pendant l'appel : 6 fonctions
                ▼
           n8n (circuit unique, 60 blocs)
                ├─ agenda : table n8n (démo) ou Google Agenda
                ├─ journal : table n8n (démo) ou Google Sheets
                ├─ alertes : ntfy (auto-hébergé) — SMS Twilio en option
                └─ résumé de fin d'appel : Claude Haiku (Anthropic)
```

- **Retell AI** gère la voix, la compréhension et les appels de fonctions (`verifier_creneaux`, `reserver_rdv`, `trouver_rdv`, `deplacer_rdv`, `annuler_rdv`, `signaler_urgence`).
- **n8n** fait tout le travail métier. Chaque requête est protégée par une clé, et une requête sans la bonne clé est refusée.
- La **logique métier** (créneaux, fuseau horaire de Paris, numéros français, signature des liens, purge…) est écrite en JavaScript pur, dans [logique/logique.js](logique/logique.js). Elle est testée hors de n8n, puis injectée dans les blocs du circuit.

## Ce qui rend le projet solide

- **Le circuit n8n est généré par du code** ([construire.js](construire.js)) au lieu d'être assemblé à la main. Les réglages viennent de [config-client.json](config-client.json) et d'un fichier `.env` privé. Changer d'artisan revient à changer ces deux fichiers.
- **65 tests automatiques** :
  - [tests/test-logique.js](tests/test-logique.js) (34) teste la logique métier : créneaux, changements d'heure, numéros, doubles réservations, signatures, purge ;
  - [tests/test-circuit.js](tests/test-circuit.js) (31) exécute le code réel des blocs du circuit construit : routes, refus, messages, alertes.
- **Sécurité** : clés de webhook, liens photo signés, contrôle que le rendez-vous appartient bien à l'appelant, aucune clé API dans le code (elles restent chiffrées dans n8n).
- **RGPD** :
  - l'appel est annoncé comme enregistré ;
  - Retell conserve enregistrements et transcriptions 30 jours ;
  - les liens d'enregistrement sont signés et expirent ;
  - n8n efface chaque nuit le journal de plus d'un an et les rendez-vous passés depuis plus de 90 jours ;
  - le guide contient un brouillon de mention d'information.

## Les choix que j'ai faits, et pourquoi

| Choix | Raison |
|---|---|
| Générer le circuit n8n par du code plutôt que le dessiner à la main | Un circuit de 60 blocs dessiné à la main est impossible à relire et à tester. Généré par du code, il se reconstruit à l'identique et se teste avant chaque mise en ligne. |
| Un seul circuit, toujours mis à jour sur place | Aucun doublon dans n8n : on sait toujours quelle version tourne. |
| Mode démo sans aucun frais | L'agenda et le journal tiennent dans des tables n8n au lieu de Google ; les alertes passent par ntfy, auto-hébergé, au lieu de SMS payants. On peut montrer la démo sans brancher les comptes d'un client. |
| Claude Haiku plutôt qu'un modèle plus gros pour le résumé de fin d'appel | J'ai repassé un appel réel avec Haiku : le résumé était aussi juste, pour un coût bien plus faible. |
| Faire revérifier chaque action par le serveur | L'agent vocal peut se tromper. C'est n8n qui contrôle qu'un créneau est libre, qu'un rendez-vous appartient bien à l'appelant et qu'il n'est pas déjà passé. |
| Penser au RGPD dès le départ | Annonce de l'enregistrement, durées de conservation, effacement automatique, liens signés : plus simple à prévoir au départ qu'à rajouter chez un client. |

## Problèmes rencontrés et résolus

- **Les variables de Retell ne sont pas remplacées partout.** Après les premiers appels réels, le journal restait vide. En lisant les exécutions de n8n, j'ai vu que Retell envoyait le texte `{{cle_fin_appel}}` au lieu de la clé. J'ai corrigé la configuration et documenté ce piège.
- **Une clé d'API invalide en pleine démo.** J'ai corrigé l'identifiant dans n8n, puis relancé l'exécution en échec, sans refaire l'appel.
- **Le formulaire photo affichait « Problem loading form ».** Dans n8n 2.x, le chemin du formulaire a changé de place ; j'ai adapté le générateur et ajouté un test.
- **Un circuit refusé à l'activation** faute d'identifiant. Le générateur relie maintenant lui-même l'identifiant, et prévient s'il manque.
- **Publier sans fuite.** L'export n8n contient des clés et des numéros. J'ai écrit [exporter-public.js](exporter-public.js), qui les remplace par des repères et refuse d'écrire le fichier s'il en reste un seul.

## Compétences mobilisées

- **Automatisation** : n8n (webhooks, formulaires, tâches planifiées, tables de données, gestion d'erreurs, API interne), conception de circuits robustes.
- **Agents IA vocaux** : Retell AI (consignes, appels de fonctions, schémas JSON, variables dynamiques), voix ElevenLabs, Claude (Anthropic) pour la synthèse.
- **JavaScript / Node.js** : logique métier sans dépendance, fuseaux horaires et changements d'heure, tests automatisés.
- **Infrastructure** : serveur auto-hébergé (Coolify), notifications ntfy, gestion des secrets et des jetons.
- **Qualité et conformité** : 65 tests, essais réels documentés, RGPD, sécurité des webhooks.

## Contenu du dépôt

| Chemin | Rôle |
|---|---|
| [logique/logique.js](logique/logique.js) | Logique métier, sans dépendance. |
| [construire.js](construire.js) | Génère le circuit n8n complet. |
| [charger-config.js](charger-config.js) | Réunit `config-client.json` et `.env`, et signale ce qui manque. |
| [exporter-public.js](exporter-public.js) | Produit une copie publiable du circuit, sans clé ni numéro. |
| [n8n/modele-public.n8n.json](n8n/modele-public.n8n.json) | Circuit prêt à importer ; les valeurs privées sont remplacées par des repères `{{…}}`. |
| [agent-retell/consignes.md](agent-retell/consignes.md) | Consignes de l'agent vocal. |
| [agent-retell/fonctions.json](agent-retell/fonctions.json) | Les fonctions de l'agent : descriptions, schémas JSON, phrases d'attente. |
| [GUIDE-BRANCHEMENT.md](GUIDE-BRANCHEMENT.md) | Guide pas à pas : branchement, réglages Retell, essais réalisés, passage à un vrai client. |

## Reproduire

Il faut Node.js 18 ou plus récent. Aucune installation de paquet n'est nécessaire.

```bash
cp .env.exemple .env      # puis remplir les valeurs
node construire.js        # écrit n8n/1.2-standardiste-vocal-batiment.n8n.json
node tests/test-logique.js
node tests/test-circuit.js
```

Ensuite, importer le circuit dans n8n, créer les identifiants (Anthropic, ntfy, Twilio en option), puis configurer l'agent Retell comme décrit dans [GUIDE-BRANCHEMENT.md](GUIDE-BRANCHEMENT.md).

## Limites connues

- C'est une démonstration : aucun vrai client ne l'utilise encore. Le transfert d'appel et la reconnaissance automatique du numéro ne marchent qu'avec un vrai numéro de téléphone, pas avec l'appel web de test.
- Les SMS (Twilio) sont prévus mais désactivés dans la démo.
- En mode Google (vrai client), l'effacement automatique de l'agenda et du tableur reste à prévoir.

---

**Johanne Pamegne** — automatisation et agents IA (VorcheX)
[Portfolio](https://johanne.vorchex.tech) · [LinkedIn](https://www.linkedin.com/in/johanne-pamegne-2672b63b4) · [GitHub](https://github.com/Johnnyrayane237)

Je cherche un poste en automatisation. Si ce projet vous parle, écrivez-moi sur LinkedIn.
