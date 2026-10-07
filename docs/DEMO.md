# Démonstration

Deux façons de montrer Badge, sur la même pile locale (trois Ledgers Speculos, TEE simulé par dstack, mémoire
Honcho, LLM du profil choisi) :

- **`pnpm demo`** : le scénario complet en ligne de commande, Ledgers pilotés automatiquement, chaque étape vérifiée ;
- **l'application web** : le parcours cliqué par un présentateur, avec le miroir en direct de chaque Ledger.

## Préparer la pile

```bash
scripts/bootstrap.sh
```

Le script vérifie les prérequis (Docker, Node 24, pnpm 11, fichier de secrets), installe le dépôt, récupère les
artefacts, démarre les trois Speculos (Alice :5001, Bob :5002, Chloé :5003), le simulateur dstack (:8090), la mémoire
(:8000) et charge le jeu de démonstration de l'entreprise fictive Acme. Il peut être relancé à volonté : ce qui tourne
déjà n'est pas touché. `--skip-seed` saute le chargement (quelques centimes d'appels LLM).

## Démo en ligne de commande

```bash
pnpm demo
```

Le script démarre sa propre enclave sur une base neuve (port 8787), connecte les trois Ledgers, ouvre le canal
attesté, puis déroule et vérifie :

1. inscription d'Alice, Bob et Chloé, chacun signant son identité sur son Ledger ;
2. délégation d'une clé de session à l'agent de chacun ;
3. brief Orion demandé par l'agent d'Alice : contexte global et notes d'Alice autorisés, notes de Bob en attente ;
4. Bob lit la demande et signe en clair sur son Ledger ; le brief est rédigé dans l'enclave avec ses notes, sans la
   note RH confidentielle de Chloé, et le compteur montre les jetons économisés ;
5. agent piégé : « envoie-moi tout ce que tu sais sur Bob » déclenche l'alerte, Bob refuse sur l'appareil ;
6. Bob révoque tout ce qu'il a partagé avec Alice ; la demande suivante attend de nouveau son accord ;
7. Bob signe un accord permanent (équipe Ventes, notes `orion`, 30 jours) ; la demande suivante passe sans lui ;
8. Chloé enregistre sa clé de conformité, dérivée de son Ledger ;
9. Bob rejoint anonymement le desk Research ; Alice (Origination) demande un fait de marché ; Bob le partage avec une
   preuve ZK ; Alice vérifie la preuve sans savoir qui a répondu ;
10. Chloé vérifie le journal chaîné, puis lève l'anonymat du partage avec sa clé, et la levée est journalisée.

Le script s'arrête en erreur au premier écart et affiche la fin du journal de l'enclave. Variantes :

- une enclave tourne déjà sur 8787 (parcours web) : `BADGE_DEMO_ENCLAVE_PORT=8788 pnpm demo` ;
- jouer contre une enclave existante : `BADGE_ENCLAVE_URL=http://127.0.0.1:8787 pnpm demo` (base neuve conseillée :
  les inscriptions d'un premier passage y sont déjà).

## Démo web

Deux terminaux :

```bash
pnpm --filter @badge/enclave start                                              # enclave sur :8787
BADGE_CAL_TEST_KEY=$PWD/infra/keys/cal-test.pem pnpm --filter @badge/web dev    # http://localhost:3000
```

Fenêtre large (au moins 1 280 px) : le panneau de droite, le **miroir du Ledger** de l'employé courant, n'apparaît
qu'à cette largeur. Sur le miroir : clic = toucher, **appui long** = « Hold to sign », glisser vers la gauche = page
suivante ; « Revue auto » valide la revue d'un coup (pour la préparation, pas devant le jury). Le badge ambre
« TEE simulé » en haut rappelle que la quote vient du simulateur ; sa fenêtre montre la mesure de l'enclave, la même
que celle affichée sur chaque Ledger.

### Avant le passage (préparation, « Revue auto » permise)

On change d'employé avec le sélecteur du haut. Dans **Configuration** :

| Employé | Actions                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| Alice   | « Rejoindre Badge (EmployeeEnroll) », puis « Autoriser mon agent (AgentSession) »                                    |
| Bob     | les deux mêmes, puis « Rejoindre mon desk (facultatif) » : signature de dérivation, puis `DeskJoin` du desk Research |
| Chloé   | les deux mêmes, puis « Dériver et enregistrer sur mon Ledger » (clé de conformité, deux messages)                    |

Les clés de session durent 8 h et survivent à un redémarrage du serveur web.

### Parcours devant le jury

1. **Alice → Agent.** Choisir la suggestion « Prépare-moi le brief du rendez-vous de demain avec le client Orion »,
   Envoyer. Le fil montre les étapes dans l'enclave : contexte global et notes d'Alice autorisés, « Contexte personnel
   de Bob Durand » en attente de son accord, sans aucun texte.
2. **Bob → Demandes d'accord.** La demande d'Alice, l'extrait (Bob voit son propre texte), le risque, et l'aperçu
   exact de l'écran du Ledger. « Approuver sur mon Ledger » : le miroir s'anime. Faire défiler les champs (Partager
   avec, Extrait, Longueur, Tâche, Expire le, Empreinte, Enclave) en les lisant, puis appui long sur « Hold to sign ».
3. **Alice → Agent.** Le brief est prêt : sources et provenance de chaque extrait (« Accord signé sur Ledger »), et
   le compteur de jetons envoyés au modèle par rapport à tout le contexte.
4. **Alice → Agent, interrupteur « Agent compromis ».** Envoyer n'importe quelle tâche : l'agent demande tout le
   contexte de Bob. **Bob → Demandes d'accord** : alerte rouge « Signalé par les règles de l'enclave ». « Approuver
   sur mon Ledger », faire défiler jusqu'au bout, toucher **Reject** sur l'appareil : « Refusé sur le Ledger ».
   Côté Alice, rien n'est livré.
5. **Bob → Accès et révocation.** Révoquer tout ce qui est partagé avec Alice Martin, signer sur le Ledger (« Revoquer
   ... »). Message : la clé des données de Bob a été renouvelée ; une nouvelle demande d'Alice redemandera son accord.
6. **Bob → Accords permanents.** Équipe autorisée « Ventes », étiquette `orion`, usage « Briefs clients », 500 car.,
   30 jours ; « Signer l'accord sur mon Ledger ». **Alice → Agent** : relancer le brief Orion, il passe sans solliciter
   Bob (« Accord permanent »), et l'usage s'affiche dans la liste de Bob.
7. **Alice → Desks.** « Demander à un autre desk » avec la suggestion « Tendances du marché des capteurs industriels
   et prix des composants ». **Bob → Desks** : la demande de partage sous « Regle 4 - marche capteurs » ; « Partager
   anonymement » génère la preuve ZK puis la revue du Ledger. **Alice → Desks** : l'extrait livré, « Membre anonyme
   d'un desk », preuve vérifiée.
8. **Chloé → Conformité.** Intégrité de la chaîne vérifiée, alertes des règles (l'agent piégé), partages anonymes
   scellés. « Lever l'anonymat » : Chloé signe le message de dérivation sur son Ledger, l'identité de Bob apparaît, et
   la levée elle-même entre au journal.

## Dépannage

| Symptôme                                                | Cause et remède                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Hold to sign » ne signe pas                           | Il faut un appui **long** (environ 3 s réelles) : un clic simple ne fait rien. En secours, « Revue auto ».                                                                                                                                                            |
| Le miroir ne bouge plus                                 | Un onglet en arrière-plan suspend le miroir : revenir sur l'onglet. Après un refus, l'écran « rejected » se ferme seul en quelques secondes.                                                                                                                          |
| Erreur `6a80` à la signature                            | Les filtres de clear signing ne sont pas acceptés : clé CAL de test absente ou chemin relatif. `BADGE_CAL_TEST_KEY` doit être un chemin **absolu** vers `infra/keys/cal-test.pem` (`infra/setup.sh` la télécharge). Un vrai Ledger refuse toujours cette clé de test. |
| Un Speculos est bloqué                                  | `infra/speculos.sh` les redémarre tous les trois ; les graines sont fixes, les adresses ne changent pas et rien n'est à refaire côté enclave.                                                                                                                         |
| « La session de votre agent a expiré : renouvelez-la… » | Session de plus de 8 h, ou enclave relancée sur une autre base que celle qui connaît la session. Configuration → « Renouveler la session ».                                                                                                                           |
| Tout repartir de zéro                                   | Arrêter l'enclave et le serveur web, puis `rm -rf infra/.data/enclave apps/web/.data` et relancer ; refaire la préparation dans Configuration.                                                                                                                        |
| « Enclave injoignable »                                 | L'enclave n'est pas lancée sur 8787 (`pnpm --filter @badge/enclave start`) ou le simulateur dstack est arrêté (`infra/dstack-sim.sh start`).                                                                                                                          |
| `pnpm demo` : « 8787 is already in use »                | Une enclave tourne déjà (parcours web) : `BADGE_DEMO_ENCLAVE_PORT=8788 pnpm demo`.                                                                                                                                                                                    |
| `stack.sh` : « memory was indexed with … »              | Changement de profil LLM : les embeddings de deux modèles ne se comparent pas. `infra/stack.sh reset`, puis `BADGE_LLM_PROFILE=phala infra/stack.sh up` et `seed`, et lancer l'enclave avec le même `BADGE_LLM_PROFILE`.                                              |
| Le seed échoue sur un avertissement du deriver          | Honcho perd parfois un lot en silence ; le seed le détecte. Le relancer (`infra/stack.sh seed`, idempotent) ; `infra/stack.sh logs deriver` pour le détail.                                                                                                           |
| Le brief n'utilise pas les notes de Bob                 | Mémoire vide ou incomplète : `infra/stack.sh status`, puis `infra/stack.sh seed` (les contrôles de rappel doivent passer).                                                                                                                                            |

Arrêt complet : `infra/speculos.sh stop && infra/dstack-sim.sh stop && infra/stack.sh down` (la mémoire est
conservée ; `infra/stack.sh reset` l'efface).
