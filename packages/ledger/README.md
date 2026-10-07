# @badge/ledger

Signature des accords Badge sur un Ledger (Speculos Flex pour la démo), côté Node.

- `LedgerSigner.connect(url)` ouvre une session DMK sur Speculos. `getAddress()`, `signBadgeMessage(kind, message)`
  (EIP-712 en **clear signing**), `signPersonalMessage(texte)` (EIP-191), `close()`. Chaque signature est vérifiée
  localement (elle doit redonner l'adresse de l'appareil) avant d'être renvoyée.
- `SpeculosDevice(url)` pilote l'écran : `screen()`, `screenshot()`, `tap()`, `swipeNext()`, `hold()`,
  `approveReview()`, `reject()`, `waitForText()`. C'est aussi la brique du « miroir Ledger » de l'interface web.
- `autoRespond(device)` approuve (ou refuse) automatiquement une revue, pour les tests et les démos scriptées.
- Erreurs typées : `UserRejectedError` (6985), `DeviceActionError` avec une explication des codes opaques (`6a80`…),
  `DeviceNavigationError`, `ClearSignSetupError`, `SignatureMismatchError`.

## Clear signing : Speculos uniquement

Le DMK n'affiche nos messages en clair que s'il reçoit des **filtres EIP-712 signés**. `BadgeClearSignLoader`
compile les descripteurs de `@badge/consent` en filtres et les signe avec la **clé CAL de test publique**
d'app-ethereum, accompagnée du certificat PKI de test Flex. Speculos l'accepte (racine PKI de test) ; un vrai Ledger
la refuse (`6a80`). Sur un vrai appareil, il faudrait que Ledger signe notre descripteur ERC-7730 (registre
`clear-signing-erc7730-registry`).

Clé attendue dans `infra/keys/cal-test.pem` (récupérée par `infra/setup.sh`, jamais versionnée), ou chemin dans
`BADGE_CAL_TEST_KEY`.

## Tests

```bash
pnpm --filter @badge/ledger test            # unitaires, sans appareil
pnpm --filter @badge/ledger test:speculos   # sur les 3 Speculos (infra/speculos.sh) ; captures dans test/live/__screens__
```

`BADGE_SPECULOS_URL` choisit l'appareil des tests de signature (alice, `http://localhost:5001`, par défaut).

## Pièges connus

- « Hold to sign » : appui, attente réelle de 3 s, relâchement (un `press-and-release` avec `delay` ne signe pas).
- Coordonnées entières obligatoires (sinon 400 silencieux) : arrondies dans `toDevicePoint`.
- Le transport Speculos annonce toujours un modèle `stax` : on ne peut pas choisir le certificat selon le modèle.
- Seul l'ASCII s'affiche : toute chaîne non ASCII est refusée avant signature.
