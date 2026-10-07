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
| `apps/enclave`     | service confidentiel : moteur de consentement, mémoire, journal de conformité         |
| `apps/web`         | application des employés et tableau de bord de conformité                             |
| `apps/mcp`         | serveur MCP pour brancher Badge sur les agents des employés                           |
| `infra`            | Speculos, stack locale, déploiement Phala                                             |

## Démarrage

```bash
pnpm install
pnpm test
```
