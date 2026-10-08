# Badge

**Le Ledger comme badge d'entreprise pour l'ère des agents.**

Badge est une couche mémoire pour les entreprises « AI native ». Elle connaît le contexte global de l'entreprise et
le contexte personnel de chaque employé, choisit pour chaque tâche le contexte utile, et ne laisse sortir un extrait
personnel qu'avec l'accord de son propriétaire, **signé en clair sur son Ledger**, sur un écran que l'agent ne peut
pas falsifier. Tout se passe dans une enclave confidentielle (Intel TDX sur Phala) que chaque client vérifie avant de
lui parler, et Badge se branche sur l'agent de chacun par un serveur MCP.

Projet de l'équipe **DVB** pour le Ledger N3XT Hackathon @ OP3N 2026.

## Le problème

Un agent IA ne vaut que le contexte qu'on lui donne. Dans une entreprise, ce contexte est de deux natures : le
contexte **global** (l'entreprise, ses clients, ses offres), ouvert à tous, et le contexte **personnel** de chaque
employé (ses notes, ses rendez-vous, ses comptes), qui n'appartient qu'à lui. Le travail avance mieux quand ce
contexte personnel circule : la commerciale qui prépare un rendez-vous gagnerait à connaître les notes du collègue qui
suit le compte depuis des années.

Aujourd'hui, c'est tout ou rien : soit chacun garde son contexte pour lui, soit on verse tout dans un outil commun et
n'importe quel agent, y compris un agent piégé par une injection de prompt, peut tout aspirer. Il manque une façon de
partager **extrait par extrait, avec l'accord explicite du propriétaire**, à l'échelle d'une grande entreprise et
d'une manière qu'une équipe conformité peut auditer.

## Comment ça marche

1. **Une enclave confidentielle** (CVM Intel TDX, Phala dstack) héberge la mémoire (Honcho, mémoire open source), le
   moteur de politique et le journal de conformité. Chaque client vérifie sa quote TDX et sa mesure avant d'ouvrir un
   canal chiffré ; le LLM est Phala Confidential AI, joint par une passerelle de sortie unique.
2. **Chaque employé délègue à son agent** une clé de session bornée (8 h), signée sur son Ledger : elle permet de
   _demander_ du contexte, jamais de le lire sans accord.
3. **Pour une tâche**, l'enclave sélectionne les extraits pertinents. Le contexte global et les notes du demandeur
   passent ; l'extrait d'un collègue passe une porte déterministe et des règles anti-aspiration, puis attend son
   accord.
4. **Le propriétaire signe sur son Ledger** un message EIP-712 lisible : destinataire, extrait, longueur, tâche,
   expiration, empreinte du texte et mesure de l'enclave. Le brief est ensuite rédigé dans l'enclave, à partir des
   seuls extraits autorisés.
5. **Pour l'entreprise** : accords permanents bornés et révocables (contre la fatigue de validation), révocation
   avec rotation de clé, journal chaîné sans aucun texte d'extrait, partage anonyme entre desks à travers un mur de
   Chine (preuves ZK Semaphore), dont seule la conformité peut lever l'anonymat avec une clé dérivée de son Ledger.

Architecture, flux, messages signés et modèle de menace : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Le scénario de démonstration

Acme, entreprise fictive. Alice (Ventes), Bob (Grands comptes), Chloé (Juridique et conformité), David et Emma
(Stratégie, desk Research), chacun avec son propre Ledger.

1. **Brief Orion.** L'agent d'Alice prépare son rendez-vous avec le client Orion. Le contexte global et ses notes
   passent ; les notes Orion de Bob attendent son accord, sans qu'Alice en voie une ligne. La note personnelle de Bob
   (ses congés) n'est même pas proposée.
2. **Accord sur le Ledger.** Bob lit sur son appareil « Partager avec : Alice Martin (Ventes) », l'extrait, la tâche,
   l'expiration et signe. Le brief arrive, avec la provenance de chaque extrait et les jetons économisés ; la note RH
   confidentielle de Chloé n'y est pas.
3. **Agent piégé.** Un agent compromis demande « tout ce que tu sais sur Bob ». L'enclave signale la demande ; Bob voit
   l'alerte et refuse sur son Ledger. Rien n'est livré.
4. **Révocation.** Bob révoque tout ce qu'il a partagé avec Alice. L'enclave prépare le message exact et son Ledger
   en nomme la vraie portée (« Tout ce que j'ai partage avec Alice Martin + accords equipe Ventes ») ; sa clé de
   données tourne et la demande suivante exige de nouveau son accord.
5. **Accord permanent.** Bob signe une fois : « l'équipe Ventes peut utiliser mes notes Orion pour des briefs
   clients, 500 caractères max, 30 jours ». Les demandes suivantes passent sans le solliciter, chaque usage est
   journalisé.
6. **Mur de Chine.** Alice (desk Origination) demande un fait de marché au desk Research, dont Bob, David et Emma
   sont membres, chacun inscrit avec son Ledger. Bob le partage avec une preuve ZK d'appartenance : Alice sait qu'un
   membre de Research a répondu, pas lequel. L'enclave refuse toute demande tant que le desk source compte moins de
   trois membres inscrits (`ANONYMITY_SET_TOO_SMALL`).
7. **Conformité.** Chloé vérifie le journal chaîné et sa tête signée par l'enclave (troncature ou retour en arrière
   détectés), puis lève l'anonymat du partage avec une clé dérivée de son Ledger ; la levée elle-même est journalisée.
8. **Dans la harness de chacun.** Le même parcours est accessible à tout agent compatible MCP, avec quatre outils
   (`badge_get_context`, `badge_task_status`, `badge_list_my_consents`, `badge_attestation`).

Comment la jouer (CLI et parcours web cliqué) : [`docs/DEMO.md`](docs/DEMO.md).

## Ce qui est réel, ce qui est simulé

| Élément                      | Dans la démo                                                                                                                                                                                                                                                       | En production                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger                       | **Speculos**, l'émulateur officiel de Ledger (cinq Flex, graines de test BIP-39 publiques), qui exécute le vrai binaire de l'app Ethereum. L'équipe n'a pas d'appareils ; Ledger autorise Speculos pour la finale.                                                 | N'importe quel Ledger avec l'app Ethereum ; le code de signature (Device Management Kit) est le même.                                                                           |
| Clear signing                | Filtres EIP-712 signés avec la **clé CAL de test** publique d'app-ethereum, acceptée par Speculos seulement (un vrai appareil répond `6a80`).                                                                                                                      | Descripteur ERC-7730 de Badge soumis au registre de clear signing et **signé par Ledger**.                                                                                      |
| Noms de contacts sur l'écran | Le destinataire est un champ texte signé, préparé et vérifié par l'enclave. Le carnet d'adresses de l'appareil (nom certifié par l'appareil) est implémenté, mais exige l'app Ethereum `develop` 1.23 (compilée par `infra/build-eth-app.sh`).                     | Activé dès la publication du carnet d'adresses dans une version de l'app Ethereum.                                                                                              |
| TEE                          | **Simulateur dstack** 0.5.3 en local : quote figée, badge ambre « TEE simulé ». **Vrai CVM Phala déjà déployé et vérifié** : quote Intel, TCB `UpToDate`, compose hash, app id, OS et KMS épinglés, aller-retour par le canal attesté ; `pnpm demo` le vise aussi. | **CVM Intel TDX sur Phala** : déploiement, épinglage des mesures et arrêt scriptés ([`docs/DEPLOY.md`](docs/DEPLOY.md)), répétition locale complète du CVM avant toute dépense. |
| LLM                          | Profil `build` (API compatible OpenAI) en développement, ou profil `phala`.                                                                                                                                                                                        | Phala Confidential AI, seule sortie du CVM, par la passerelle qui détient la clé.                                                                                               |
| Données                      | Entreprise fictive Acme (15 notes, cinq employés). Le groupe d'anonymat du desk Research est fait de trois vrais détenteurs de Ledger (Bob, David, Emma), aux graines de test publiques : l'anonymat y reste illustratif.                                          | Annuaire et contexte issus des outils de l'entreprise.                                                                                                                          |
| Toujours réel                | Signatures Ledger et leur vérification, canal attesté et sa cryptographie, preuves Groth16 Semaphore, moteur de politique, règles anti-aspiration, révocations, journal chaîné, mémoire et LLM.                                                                    |                                                                                                                                                                                 |

## Démarrage rapide

Prérequis : **Docker** (avec Compose), **Node 24**, **pnpm 11**, `curl`, `git`, `openssl`, et un fichier de secrets
hors du dépôt (`../.env` par défaut, ou `BADGE_ENV_FILE`) rempli d'après [`.env.example`](.env.example).

```bash
scripts/bootstrap.sh     # prérequis, installation, artefacts, 5 Speculos, simulateur dstack, mémoire, jeu de démo
pnpm demo                # le scénario complet en direct (18 étapes), chaque étape vérifiée
```

Contre le CVM Phala déployé (vrai quote TDX exigé, toutes les épingles) :

```bash
BADGE_ENCLAVE_URL=<endpoint> BADGE_ENCLAVE_OS_MEASUREMENTS_FILE=infra/cvm/expected-measurements.json pnpm demo
```

Parcours web (deux terminaux), puis http://localhost:3000 (page de présentation) et http://localhost:3000/demo (démo) :

```bash
pnpm --filter @badge/enclave start
pnpm desks:seed          # une fois l'enclave lancée : David et Emma rejoignent le desk Research
BADGE_CAL_TEST_KEY=$PWD/infra/keys/cal-test.pem pnpm --filter @badge/web dev
```

Brancher Badge sur un agent : [`apps/mcp/README.md`](apps/mcp/README.md).

## Organisation du dépôt

| Dossier            | Rôle                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/consent` | Messages EIP-712 de Badge, descripteurs de clear signing, vérification des signatures (pur, sans E/S)                                       |
| `packages/ledger`  | Signature sur Ledger via le Device Management Kit, filtres de clear signing, pilotage de Speculos                                           |
| `packages/zk`      | Identités anonymes de desk (Semaphore v4) et preuves d'appartenance                                                                         |
| `packages/attest`  | Vérification d'attestation TDX (dstack), canal chiffré attesté, boîtes scellées, clé de conformité                                          |
| `packages/client`  | SDK typé de l'API de l'enclave, partagé par l'application web, le serveur MCP et la démo                                                    |
| `apps/enclave`     | Service confidentiel : politique, consentements, mémoire, LLM, desks, conformité, journal chaîné                                            |
| `apps/web`         | Application des employés et de la conformité (Next.js), miroir des Ledgers, runtime d'agent                                                 |
| `apps/mcp`         | Serveur MCP : Badge dans la harness d'agent de chaque employé                                                                               |
| `infra`            | Speculos, simulateur dstack, mémoire Honcho et passerelle, jeu de démonstration, CVM Phala                                                  |
| `scripts`          | `bootstrap.sh` (pile locale en une commande), `demo.ts` (`pnpm demo`) et `seed-desks.ts` (`pnpm desks:seed`)                                |
| `docs`             | [Architecture](docs/ARCHITECTURE.md), [démonstration](docs/DEMO.md), [API de l'enclave](docs/enclave-api.md), [déploiement](docs/DEPLOY.md) |

## Tests

```bash
pnpm test        # plus de 600 tests, sans réseau ni appareil, en une quinzaine de secondes
pnpm lint        # ESLint + Prettier
pnpm typecheck
```

Les tests unitaires couvrent la logique critique (politique de consentement, vérification des signatures,
attestation, preuves ZK) et un test de contrat fait jouer tout le scénario au SDK contre l'application réelle de
l'enclave. Suites en direct, sur la pile locale :

| Commande                                                                                 | Ce qu'elle vérifie                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm --filter @badge/attest test:sim`, `@badge/enclave test:sim`, `@badge/mcp test:sim` | Canal attesté de bout en bout contre le simulateur dstack           |
| `pnpm --filter @badge/ledger test:speculos`                                              | Signatures en clear signing sur les Speculos                        |
| `pnpm --filter @badge/enclave test:live`                                                 | Mémoire et LLM réels (quelques appels payants)                      |
| `pnpm demo`                                                                              | Le scénario complet, avec de vraies signatures sur les cinq Ledgers |

## Modèle de sécurité en bref

- **Le Ledger fait foi** : aucun extrait personnel ne sort de son périmètre sans une signature du propriétaire sur un
  écran que ni l'agent ni le serveur web ne contrôlent. Le message signé porte l'empreinte du texte exact et la mesure
  de l'enclave.
- **L'enclave est vérifiée avant d'être crue** : quote TDX, rejeu des mesures, compose hash, app id, image OS et
  KMS épinglés, puis seulement un canal chiffré. Réseau interne scellé, une seule sortie vers le LLM confidentiel,
  dont l'hôte est figé dans le code attesté (seule la clé est secrète), secrets générés dans le CVM.
- **Échec fermé partout** : nonces consommés de façon atomique, expirations, horloge et anti-rejeu sur chaque requête,
  règles anti-aspiration déterministes, accord permanent jamais appliqué à une demande signalée.
- **Auditable sans être indiscret** : journal append-only chaîné par sha256, sans texte d'extrait, dont la tête est
  signée par une clé de l'enclave (dérivée du KMS) ; anonymat des desks levé uniquement par la conformité, avec une
  clé dérivée de son Ledger, et chaque levée est journalisée.

Menaces, atténuations et risques résiduels : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#5-modèle-de-menace).

## Licence

[MIT](LICENSE).

## Équipe

**DVB**, pour le Ledger N3XT Hackathon @ OP3N 2026.
