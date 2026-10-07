# @badge/consent

Le contrat de consentement de Badge : messages EIP-712 signés sur le Ledger, format JSON d'échange et vérifications
sans état. Paquet pur (aucune E/S), partagé par l'application web, le pont Ledger et l'enclave.

## Contenu

| Module          | Rôle                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `messages.ts`   | Domaine, structures EIP-712, descripteurs d'affichage (clear signing), messages EIP-191 (identité de desk, clé conformité).  |
| `ascii.ts`      | `toDeviceAscii` / `assertDeviceAscii` : le Ledger n'affiche que l'ASCII, toute chaîne affichée passe par là avant signature. |
| `excerpt.ts`    | `hashExcerpt` (keccak256 UTF-8), `excerptLength` (en points de code), `taskIdFrom`.                                          |
| `typed-data.ts` | `badgeTypedData` (charge utile viem / DMK, avec `EIP712Domain`), `hashBadgeMessage` (= identifiant d'accord).                |
| `wire.ts`       | Schémas zod stricts du format JSON (bigint en chaîne décimale), `encode*` / `decode*`, enveloppe `SignedMessage`.            |
| `verify.ts`     | `verifyBadgeSignature`, `claimedSigner` et les contrôles intrinsèques `check*`.                                              |
| `errors.ts`     | `ConsentError` et ses sous-classes, avec un `code` machine stable.                                                           |

## Principes

- **Échec fermé** : chaque contrôle lève une `ConsentError` (avec `code`) au premier problème et ne renvoie rien en
  cas de succès ; il n'y a pas de résultat qu'on pourrait oublier de lire.
- **Ordre d'affichage** : l'appareil affiche les champs dans l'ordre de la structure ; les champs affichés sont donc
  en tête de chaque structure (vérifié par les tests d'invariants des descripteurs).
- **Sans état** : le paquet ne vérifie ni la réutilisation des nonces, ni les révocations, ni l'annuaire ; c'est le
  rôle de l'enclave. Le temps (`now`, en secondes Unix `bigint`) est injecté.
- **Horizons bornés** : partage ponctuel et partage de desk 7 jours, session d'agent 7 jours, accord permanent 90
  jours, inscription valable 1 jour (constantes `MAX_*`).

## Utilisation type (enclave)

```ts
const signed = decodeSignedMessage(body, "ContextShare");
await verifyBadgeSignature(signed.kind, signed.message, signed.signature, signed.message.owner);
checkContextShare(signed.message, { now: toUnixSeconds(new Date()), enclaveMeasurement, excerptText });
// puis : nonce non utilisé, accord non révoqué (état de l'enclave)
```

## Scripts

```sh
pnpm --filter @badge/consent typecheck
pnpm vitest run --project consent
```
