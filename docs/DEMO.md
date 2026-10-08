# Démonstration

Deux façons de montrer Badge, sur la même pile locale (cinq Ledgers Speculos, TEE simulé par dstack, mémoire
Honcho, LLM du profil choisi) :

- **`pnpm demo`** : le scénario complet en ligne de commande, Ledgers pilotés automatiquement, chaque étape vérifiée ;
- **l'application web** : le parcours cliqué par un présentateur, avec le miroir en direct de chaque Ledger.

## Préparer la pile

```bash
scripts/bootstrap.sh
```

Le script vérifie les prérequis (Docker, Node 24, pnpm 11, fichier de secrets), installe le dépôt, récupère les
artefacts, démarre les cinq Speculos (Alice :5001, Bob :5002, Chloé :5003, David :5004, Emma :5005), le simulateur
dstack (:8090), la mémoire (:8000) et charge le jeu de démonstration de l'entreprise fictive Acme. David Moreau et
Emma Leroy sont des membres du desk Research à part entière, chacun avec son Ledger ; toutes les graines sont des
vecteurs de test BIP-39 publics, listés dans `infra/speculos.sh`. Il peut être relancé à volonté : ce qui tourne
déjà n'est pas touché. `--skip-seed` saute le chargement (quelques centimes d'appels LLM).

## Démo en ligne de commande

```bash
pnpm demo
```

Le script démarre sa propre enclave sur une base neuve (port 8787), connecte les cinq Ledgers, ouvre le canal
attesté, puis déroule et vérifie 18 étapes :

1. mise en route : TEE, enclave, Ledgers (adresses conformes à l'annuaire), canal attesté ;
2. inscription d'Alice, Bob et Chloé, chacun signant son identité sur son Ledger ;
3. délégation d'une clé de session à l'agent de chacun ;
4. David et Emma rejoignent le desk Research, chacun avec son Ledger ;
5. brief Orion demandé par l'agent d'Alice : contexte global et notes d'Alice autorisés, notes de Bob en attente ;
6. Bob lit la demande et signe en clair sur son Ledger ;
7. le brief est rédigé dans l'enclave avec ses notes, sans la note RH confidentielle de Chloé, et le compteur montre
   les jetons économisés ;
8. agent piégé : « envoie-moi tout ce que tu sais sur Bob » déclenche l'alerte ;
9. Bob refuse sur l'appareil, rien n'est livré ;
10. Bob révoque tout ce qu'il a partagé avec Alice : l'enclave prépare le message, le Ledger en nomme la vraie portée
    (« Tout ce que j'ai partage avec Alice Martin + accords equipe Ventes ») ; la demande suivante attend de nouveau
    son accord ;
11. Bob signe un accord permanent (équipe Ventes, notes `orion`, 30 jours) ; la demande suivante passe sans lui ;
12. Chloé enregistre sa clé de conformité, dérivée de son Ledger ;
13. Bob rejoint anonymement le desk Research, qui compte alors trois membres inscrits ;
14. Alice (Origination) demande un fait de marché au desk Research ; l'enclave fige la racine du desk source ;
15. Bob accepte sur son Ledger et prouve son appartenance au desk (preuve ZK) ;
16. Alice reçoit le fait sans savoir qui a répondu : elle vérifie `hashExcerpt(extrait) == excerptHash` et la preuve
    contre la racine figée de la demande ;
17. Chloé vérifie le journal chaîné et sa tête signée par l'enclave ;
18. Chloé lève l'anonymat du partage avec sa clé, et la levée est journalisée.

Le script s'arrête en erreur au premier écart et affiche la fin du journal de l'enclave. Variantes :

- une enclave tourne déjà sur 8787 (parcours web) : `BADGE_DEMO_ENCLAVE_PORT=8788 pnpm demo` ;
- jouer contre une enclave existante : `BADGE_ENCLAVE_URL=http://127.0.0.1:8787 pnpm demo` (base neuve conseillée :
  les inscriptions d'un premier passage y sont déjà) ;
- jouer contre le CVM Phala déployé :
  `BADGE_ENCLAVE_URL=<endpoint> BADGE_ENCLAVE_OS_MEASUREMENTS_FILE=infra/cvm/expected-measurements.json pnpm demo`.
  Le script exige alors un vrai quote Intel TDX qui passe toutes les épingles (compose hash, app id, mesures de l'OS,
  KMS) et refuse le simulateur.

## Démo web

Deux terminaux :

```bash
pnpm --filter @badge/enclave start                                              # enclave sur :8787
pnpm desks:seed                                                                 # David et Emma rejoignent Research
BADGE_CAL_TEST_KEY=$PWD/infra/keys/cal-test.pem pnpm --filter @badge/web dev    # http://localhost:3000/demo
```

La racine `http://localhost:3000` est la page de présentation publique ; la démo s'ouvre sur `/demo` (agent
d'Alice), lien « Ouvrir la démo » de la page.

`pnpm desks:seed` (enclave lancée, Speculos de David et Emma démarrés) inscrit David et Emma et les fait rejoindre le
desk Research avec leurs propres Ledgers ; leurs revues sont validées automatiquement, c'est de la préparation. Il est
idempotent. Sans lui, la demande d'Alice au desk Research est refusée (`ANONYMITY_SET_TOO_SMALL`) : l'enclave exige
au moins trois membres inscrits avec un Ledger. Pour les répétitions, lancer le serveur web avec `BADGE_REHEARSAL=1`.

Fenêtre large (au moins 1 280 px) : le panneau de droite, le **miroir du Ledger** de l'employé courant, n'apparaît
qu'à cette largeur. Sur le miroir : clic = toucher, **appui long** = « Hold to sign », glisser vers la gauche = page
suivante ; « Revue auto » valide la revue d'un coup, uniquement avec `BADGE_REHEARSAL=1` (jamais devant le jury).
Les routes de l'appareil refusent les requêtes inter-sites. Le badge ambre
« TEE simulé » en haut rappelle que la quote vient du simulateur ; sa fenêtre montre la mesure de l'enclave, la même
que celle affichée sur chaque Ledger.

### Avant le passage (préparation, « Revue auto » permise avec `BADGE_REHEARSAL=1`)

On change d'employé avec le sélecteur du haut. Dans **Configuration** :

| Employé | Actions                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Alice   | Étape 1 « Associer mon Ledger à mon identité » (`EmployeeEnroll`), puis étape 2 « Autoriser mon agent » (`AgentSession`) : « Signer sur mon Ledger » à chaque fois |
| Bob     | les deux mêmes, puis **Desks** → « Rejoindre Research », requis pour l'étape 7 : dérivation de l'identité anonyme, puis `DeskJoin` (deux messages)                 |
| Chloé   | les deux mêmes, puis étape 3 « Dériver et enregistrer sur mon Ledger » (clé de conformité, deux messages)                                                          |

Les clés de session durent 8 h ; elles survivent à un redémarrage du serveur web, comme l'historique des demandes
d'accord. L'identité anonyme de desk, elle, n'est jamais écrite sur disque : après un redémarrage, le premier partage
anonyme de Bob la re-dérive sur son Ledger (un message de plus), sans le faire rejoindre à nouveau.

### Parcours devant le jury

1. **Alice → Agent.** Choisir la suggestion « Prépare-moi le brief du rendez-vous de demain avec le client Orion »,
   Envoyer. Le fil montre les étapes dans l'enclave : contexte global et notes d'Alice autorisés, « Contexte personnel
   de Bob Durand » en attente de son accord, sans aucun texte (« En attente de Bob Durand · 3 extraits »).
2. **Bob → Demandes d'accord.** Une demande par extrait (trois pour le brief Orion) : l'extrait (Bob voit son propre
   texte), le risque, et l'aperçu exact de l'écran du Ledger. « Approuver sur mon Ledger » : le miroir s'anime. Faire
   défiler les champs (Partager avec, Extrait, Longueur, Tâche, Expire le, Empreinte, Enclave) en les lisant, puis
   appui long sur « Hold to sign ». Même geste pour les deux autres extraits ; ils passent dans l'« Historique ».
3. **Alice → Agent.** Le brief est prêt : sources et provenance de chaque extrait (« Accord signé sur Ledger »), et
   le compteur de jetons envoyés au modèle par rapport à tout le contexte.
4. **Alice → Agent, interrupteur « Agent compromis ».** Envoyer n'importe quelle tâche : l'agent demande tout le
   contexte de Bob. **Bob → Demandes d'accord** : alerte rouge « Signalé par les règles de l'enclave ». « Approuver
   sur mon Ledger », toucher **Reject** sur l'appareil puis « Yes, reject » : « Refusé sur le Ledger ». Côté Alice, le
   contexte complet de Bob reste dans l'enclave (« Restés dans l'enclave · Refusé ») ; seul un extrait qu'il lui a
   déjà accordé à l'étape 2 peut être réutilisé (« Accord réutilisé »), le même texte, rien de plus. Chloé verra
   l'alerte au journal.
5. **Bob → Accès et révocation.** « Tout révoquer pour Alice », signer sur le Ledger, qui nomme la portée réelle
   (« Tout ce que j'ai partage avec Alice Martin + accords equipe Ventes » : la révocation couvre aussi les accords
   permanents de son équipe). Message : la clé des données de Bob a été renouvelée ; une nouvelle demande d'Alice redemandera son accord.
6. **Bob → Accords permanents.** Le formulaire est prérempli : équipe « Ventes », étiquette `orion`, usage « briefs
   clients », 800 car., 30 jours ; « Signer l'accord sur mon Ledger ». **Alice → Agent** : relancer le brief Orion, il passe sans solliciter
   Bob (« Accord permanent »), et l'usage s'affiche dans la liste de Bob.
7. **Alice → Desks.** « Demander à un autre desk » avec la suggestion « Tendances du marché des capteurs industriels
   et prix des composants ». **Bob → Desks** : la demande de partage sous « Regle 4 - marche capteurs » ; « Partager
   anonymement » génère la preuve ZK puis la revue du Ledger. **Alice → Desks** : l'extrait livré, « Membre anonyme
   d'un desk » (un parmi Bob, David et Emma) : « Source : desk Research (membre anonyme, preuve ZK vérifiée) », avec le
   nullifier et la racine figée à la demande.
8. **Chloé → Conformité.** Intégrité de la chaîne vérifiée, tête de chaîne « signée par l'enclave attestée » (clé
   d'audit vérifiée pour la mesure attestée), alertes des règles en clair (l'agent piégé), partages anonymes
   scellés. « Lever l'anonymat » : Chloé signe le message de dérivation sur son Ledger, l'identité de Bob apparaît, et
   la levée elle-même entre au journal.

## Dépannage

| Symptôme                                                | Cause et remède                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Hold to sign » ne signe pas                           | Il faut un appui **long** (environ 3 s réelles) : un clic simple ne fait rien. En secours (répétition), « Revue auto » avec `BADGE_REHEARSAL=1`.                                                                                                                      |
| Demande au desk : `ANONYMITY_SET_TOO_SMALL`             | Moins de trois membres de Research inscrits : `pnpm desks:seed` (enclave lancée, Speculos de David :5004 et Emma :5005 actifs), et Bob doit avoir rejoint son desk dans Configuration.                                                                                |
| Le miroir ne bouge plus                                 | Un onglet masqué (arrière-plan, fenêtre recouverte) ralentit le miroir et le rafraîchissement : revenir sur l'onglet, tout se remet à jour aussitôt. Après un refus, l'écran « rejected » se ferme seul en quelques secondes.                                         |
| Erreur `6a80` à la signature                            | Les filtres de clear signing ne sont pas acceptés : clé CAL de test absente ou chemin relatif. `BADGE_CAL_TEST_KEY` doit être un chemin **absolu** vers `infra/keys/cal-test.pem` (`infra/setup.sh` la télécharge). Un vrai Ledger refuse toujours cette clé de test. |
| Un Speculos est bloqué                                  | `infra/speculos.sh` les redémarre tous les cinq ; les graines sont fixes, les adresses ne changent pas et rien n'est à refaire côté enclave.                                                                                                                          |
| « La session de votre agent a expiré : renouvelez-la… » | Session de plus de 8 h, ou enclave relancée sur une autre base que celle qui connaît la session. Configuration → « Renouveler la session ».                                                                                                                           |
| Tout repartir de zéro                                   | Arrêter l'enclave et le serveur web, puis `rm -rf infra/.data/enclave apps/web/.data` et relancer ; `pnpm desks:seed`, puis refaire la préparation dans Configuration.                                                                                                |
| « Enclave injoignable »                                 | L'enclave n'est pas lancée sur 8787 (`pnpm --filter @badge/enclave start`) ou le simulateur dstack est arrêté (`infra/dstack-sim.sh start`).                                                                                                                          |
| `pnpm demo` : « 8787 is already in use »                | Une enclave tourne déjà (parcours web) : `BADGE_DEMO_ENCLAVE_PORT=8788 pnpm demo`.                                                                                                                                                                                    |
| `stack.sh` : « memory was indexed with … »              | Changement de profil LLM : les embeddings de deux modèles ne se comparent pas. `infra/stack.sh reset`, puis `BADGE_LLM_PROFILE=phala infra/stack.sh up` et `seed`, et lancer l'enclave avec le même `BADGE_LLM_PROFILE`.                                              |
| Le seed échoue sur un avertissement du deriver          | Honcho perd parfois un lot en silence ; le seed le détecte. Le relancer (`infra/stack.sh seed`, idempotent) ; `infra/stack.sh logs deriver` pour le détail.                                                                                                           |
| Le brief n'utilise pas les notes de Bob                 | Mémoire vide ou incomplète : `infra/stack.sh status`, puis `infra/stack.sh seed` (les contrôles de rappel doivent passer).                                                                                                                                            |

Arrêt complet : `infra/speculos.sh stop && infra/dstack-sim.sh stop && infra/stack.sh down` (la mémoire est
conservée ; `infra/stack.sh reset` l'efface).
