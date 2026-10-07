# @badge/attest

Vérification de l'enclave Badge (Intel TDX via dstack / Phala) et canal chiffré attesté entre un client et
l'enclave.

- `@badge/attest` : Node **et** navigateur (noble pour la crypto, pas de `node:crypto`).
- `@badge/attest/server` : Node uniquement, côté enclave (`@phala/dstack-sdk`).

## Flux

1. Le client crée `ClientChannel.create()` et envoie `hello` (`nonce` + clé publique X25519 éphémère).
2. L'enclave fait `EnclaveChannel.accept(hello, cléSecrète)` (clé statique dérivée par `deriveChannelKeyPair`),
   puis `createAttestationBundle(dstack, { ...hello, enclavePk })` : quote dont le `report_data` vaut
   `sha512(nonce || clientPk || enclavePk)`, event log et `app_compose` exact.
3. Le client appelle `verifyAttestation({ ...bundle, ...client.hello, mode, expectedComposeHash, expectedAppId,
expectedOsMeasurements })`, puis
   `client.establish(résultat)`. Aucune clé de session n'existe avant une attestation valide.
4. Messages : `seal` / `open` (AES-256-GCM, clés HKDF-SHA256 distinctes par sens, numéro de séquence strict :
   rejeu, réordonnancement et altération refusés).

`enclaveMeasurement` (messages EIP-712) = `enclaveMeasurementFrom(composeHash)` : le compose hash en bytes32.

## Boîtes scellées et clé de conformité

- `sealToPublicKey(clePubliqueX25519, texte)` / `openSealed(cleSecrete, boite)` : chiffrement vers une clé publique
  sans échange préalable (X25519 éphémère + HKDF-SHA256 + AES-256-GCM, enveloppe JSON versionnée
  `{ v: 1, alg, epk, nonce, ciphertext }`). L'enclave y scelle l'identité du signataire d'un partage de desk anonyme.
- `complianceKeyFromSignature(signature)` : la responsable conformité signe `complianceKeyDeriveMessage(entreprise)`
  (EIP-191) sur son Ledger ; clé secrète = keccak256(signature), clé publique = X25519. Les signatures Ledger sont
  déterministes (RFC 6979) : même Ledger, même clé, rien à sauvegarder. **Cette signature est le secret** : elle ne
  quitte jamais le navigateur. L'enregistrement de la clé publique passe par une seconde signature, distincte, de
  `complianceKeyRegistrationMessage(entreprise, clePublique)`.

## Modes de vérification

| Contrôle                                                            | `tdx`       | `simulated`   |
| ------------------------------------------------------------------- | ----------- | ------------- |
| Signature Intel DCAP + TCB `UpToDate` (`@phala/dcap-qvl`)           | obligatoire | ignoré        |
| TD hors mode debug                                                  | obligatoire | avertissement |
| `report_data` = sha512(nonce, clientPk, enclavePk)                  | obligatoire | obligatoire   |
| Rejeu RTMR0-3 et recalcul des digests RTMR3                         | obligatoire | obligatoire   |
| sha256(`app_compose`) = compose hash attesté                        | obligatoire | avertissement |
| `public_logs` / `public_sysinfo` à false, KMS actif                 | obligatoire | avertissement |
| Fournisseur de clés `kms`                                           | obligatoire | avertissement |
| Compose hash attendu (`expectedComposeHash`)                        | exigé       | si fourni     |
| App id, mesures de l'OS (`expectedAppId`, `expectedOsMeasurements`) | exigés      | si fourni     |
| Identité du KMS (`expectedKeyProviderId`)                           | si fourni   | si fourni     |
| `allowed_envs` sans point de terminaison (`*_URL`, `*_HOST`...)     | obligatoire | avertissement |

Le mode `simulated` renvoie `simulated: true` : l'interface doit afficher un badge orange « TEE simulé ».

## Simulateur local

```bash
infra/dstack-sim.sh start   # télécharge dstack 0.5.3 (sha256 vérifié) dans infra/vendor, écoute sur 127.0.0.1:8090
pnpm --filter @badge/attest test:sim
infra/dstack-sim.sh stop
```

`DSTACK_SIMULATOR_ENDPOINT=http://127.0.0.1:8090` pointe le SDK vers le simulateur. Les données du simulateur sont
figées (quote, event log, compose hash sans rapport avec son `app_compose`) : elles ne prouvent rien.

## Limites connues

- Les mesures de l'image OS dstack (MRTD, RTMR0-2) ne sont vérifiées que si `expectedOsMeasurements` est fourni :
  à capturer une fois sur le vrai CVM, c'est ce qui exclut une image de dev.
- Dans le navigateur, `@phala/dcap-qvl` (mode `tdx`) a besoin des polyfills `buffer` / `crypto` ; il n'est chargé
  qu'à la demande (import dynamique).
