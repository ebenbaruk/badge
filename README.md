# Badge

**Le Ledger comme badge d'entreprise pour l'ère des agents.**

Les agents IA d'une entreprise ne valent que le contexte qu'on leur donne. Badge garde le contexte global de
l'entreprise et le contexte personnel de chaque employé dans une enclave confidentielle (TEE), choisit le contexte
utile à chaque tâche, et ne fait sortir un extrait personnel qu'avec l'accord de son propriétaire, signé sur son
Ledger, sur un écran que l'agent ne peut pas falsifier.

Projet de l'équipe DVB pour le Ledger N3XT Hackathon @ OP3N 2026.

> Statut : en construction.

## Structure

| Dossier            | Rôle                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `packages/consent` | messages EIP-712 de Badge, descripteurs de clear signing, vérification des signatures |
| `packages/ledger`  | signature sur Ledger via le Device Management Kit, pilotage de Speculos               |
| `packages/zk`      | identités anonymes de desk (Semaphore) et preuves d'appartenance                      |
| `packages/attest`  | vérification d'attestation TDX (Phala dstack) et canal chiffré vers l'enclave         |
| `packages/client`  | SDK typé de l'API de l'enclave (canal attesté, requêtes signées, réponses validées)   |
| `apps/enclave`     | service confidentiel : moteur de consentement, mémoire, journal de conformité         |
| `apps/web`         | application des employés et tableau de bord de conformité                             |
| `apps/mcp`         | serveur MCP pour brancher Badge sur les agents des employés                           |
| `infra`            | Speculos, stack locale, déploiement Phala                                             |
| `scripts`          | démonstration de bout en bout en direct (`pnpm demo`)                                 |

## Démarrage

```bash
pnpm install
pnpm test
```

## Démonstration de bout en bout

Sur la pile locale (TEE simulé, mémoire Honcho, profil LLM de build, trois Ledgers Speculos) :

```bash
infra/setup.sh                       # artefacts ZK, clé CAL de test, app Ethereum
infra/speculos.sh                    # Alice :5001, Bob :5002, Chloé :5003
infra/stack.sh up && infra/stack.sh seed
pnpm demo                            # démarre le simulateur dstack et l'enclave si besoin
```

Le script déroule le scénario complet par le canal attesté, avec de vraies signatures sur les Ledgers : brief Orion
après accord de Bob, agent piégé refusé, révocation, accord permanent, partage anonyme entre desks avec preuve ZK,
levée d'anonymat par la conformité. Chaque étape est vérifiée ; il s'arrête en erreur au premier écart.
`BADGE_ENCLAVE_URL` le fait jouer contre une enclave déjà lancée.
