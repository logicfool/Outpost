# Outpost - VALORANT companion

A React Native / Expo app for iOS and Android that brings your VALORANT account to your phone.

## Features

- **Store** - daily offers, featured bundles, Night Market and accessories, with wallet balances, a wishlist and saved store history. Optional, confirmation-guarded VP purchases.
- **Collection** - skins with levels, variants and video previews, plus buddies, sprays, player cards, titles and agents. Equip skins, buddies, sprays, cards and titles, and save loadout presets.
- **Battle Pass and missions** - pass and contract progress, daily checkpoints, weekly missions, queued weeklies and upcoming weeks.
- **Profile** - rank and career, match history with mode, map, agent and result filters, detailed match reports with round maps and a duel matrix.
- **Live game** - the current match roster with ranks and equipped skins.
- **Party** - your current party with queue selection, start and stop queue, ready state, invitations and party codes.
- **Friends** - presence, friend requests and direct chat with locally encrypted history.
- **Crosshair and sensitivity** - import, edit and preview crosshair codes and save presets.
- Multiple accounts, themes, notifications, and account backups.

## Development

Requires Node 22.13 or newer and npm.

```sh
npm ci
npm test            # core unit tests
npm run typecheck
npm run check:syntax
npm start
```

The app uses native modules (TCP/TLS sockets, SQLCipher, secure storage), so it runs in a development build rather than Expo Go:

```sh
npm run android
npm run ios
```

The browser build runs in demo mode only:

```sh
npx playwright install chromium
npm run test:ui
```

## Release builds

`.github/workflows/release-builds.yml` builds a release APK and an unsigned iOS IPA. Run it from the Actions tab or by pushing a `v*` tag. The Android job needs an `ANDROID_DEBUG_KEYSTORE_BASE64` repository secret containing the signing key used by existing installs:

```sh
gh secret set ANDROID_DEBUG_KEYSTORE_BASE64 --body "$(base64 -i android/app/debug.keystore)"
```

The iOS job builds with Xcode 26.6; building iOS locally needs Xcode 26.4 or newer. The IPA is unsigned and must be signed before it can be installed on an iPhone.

## Privacy

Riot sign-in happens on Riot's own page; passwords are never stored. Tokens and cookies are kept in the device's secure storage, and chat history is stored in a per-account encrypted database. There is no Outpost server: the app talks to Riot's services directly.

## Disclaimer

Outpost is not endorsed by Riot Games. It uses unofficial Riot client APIs, which may change or stop working at any time.
