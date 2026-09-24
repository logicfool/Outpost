// Selected public cosmetic metadata from https://valorant-api.com/v1/, 2026-09-24.
// Storefront and account responses in tests are synthetic, not authenticated captures.
const version = 'release-13.06-shipping-13-5435758';
const MAP = 'dd3a1cd9-41b1-50ea-3bd6-a7bb3c5978bd';
const CARD = '1ecb8866-4410-aff2-8a56-e1bdd3d1a83a';
const BUNDLE = '0e404df8-4974-b90d-d9e1-7ca81e39f752';
const WEAPON = '8db0a1bf-4a50-832a-4566-faaaa6d250ca';
const SKIN = '7a6c65d8-4439-cf7b-1138-e2883f53bff8';
const LEVEL = '3cda025f-468b-3a1d-8936-b1b26d7c8fe5';
const CHROMA = 'deb6d1b0-4a31-ba38-a1f1-f8965af2aee3';
const image = (path) => 'https://media.valorant-api.com/' + path;
const responses = {
  maps: {
    data: [
      {
        uuid: MAP,
        displayName: 'Gauntlet',
        mapUrl: '/Game/Maps/AbilityDraft/AbilityDraft',
        splash: image(`maps/${MAP}/splash.png`),
        listViewIcon: image(`maps/${MAP}/listviewicon.png`),
        displayIcon: null,
        xMultiplier: 0,
        yMultiplier: 0,
        xScalarToAdd: 0,
        yScalarToAdd: 0,
      },
    ],
  },
  playercards: {
    data: [
      {
        uuid: CARD,
        displayName: 'Warden Card',
        displayIcon: image(`playercards/${CARD}/displayicon.png`),
        smallArt: image(`playercards/${CARD}/smallart.png`),
        wideArt: image(`playercards/${CARD}/wideart.png`),
        largeArt: image(`playercards/${CARD}/largeart.png`),
      },
    ],
  },
  bundles: {
    data: [
      {
        uuid: BUNDLE,
        displayName: 'Warden Launch',
        displayIcon: image(`bundles/${BUNDLE}/displayicon.png`),
        displayIcon2: image(`bundles/${BUNDLE}/displayicon2.png`),
        assetPath:
          'ShooterGame/Content/UI/OutOfGame/MainMenu/Store/Bundles/StorefrontItem_BRReleaseCapsuleThemeBundle_DataAsset',
      },
    ],
  },
  weapons: {
    data: [
      {
        uuid: WEAPON,
        displayName: 'Warden',
        category: 'EEquippableCategory::Rifle',
        displayIcon: image(`weapons/${WEAPON}/displayicon.png`),
        defaultSkinUuid: '61d99a36-4033-0fa9-2c94-71aaf901e120',
        skins: [
          {
            uuid: SKIN,
            displayName: 'Galleria Warden',
            themeUuid: '14a4d891-4db3-ad2d-8cd9-01afb22ca6c8',
            contentTierUuid: '12683d76-48d7-84a3-4e09-6985794f0445',
            displayIcon: image(`weaponskins/${SKIN}/displayicon.png`),
            assetPath:
              'ShooterGame/Content/Equippables/Guns/Rifles/BattleRifle/Galleria2/BattleRifle_Galleria2_PrimaryAsset',
            levels: [
              {
                uuid: LEVEL,
                displayName: 'Galleria Warden',
                displayIcon: image(`weaponskinlevels/${LEVEL}/displayicon.png`),
              },
            ],
            chromas: [
              {
                uuid: CHROMA,
                displayName: 'Galleria Warden',
                fullRender: image(`weaponskinchromas/${CHROMA}/fullrender.png`),
              },
            ],
          },
        ],
      },
    ],
  },
};
module.exports = { version, MAP, CARD, BUNDLE, WEAPON, SKIN, LEVEL, CHROMA, responses };
