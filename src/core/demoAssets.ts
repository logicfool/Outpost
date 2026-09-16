import type { Catalog, CatalogItem } from './types';

export const DEMO_ART: {
  cards: CatalogItem[];
  titles: CatalogItem[];
  agents: Record<string, string>;
  maps: Catalog['maps'];
  tiers: Catalog['tiers'];
  skins: Record<string, Partial<CatalogItem>>;
  bundles: Catalog['bundles'];
} = {
  'cards': [
    {
      'id': 'd010298a-48e7-5eb9-528e-569c44644084',
      'canonicalId': 'd010298a-48e7-5eb9-528e-569c44644084',
      'kind': 'card',
      'name': "Today's Specials Card",
      'image':
        'https://media.valorant-api.com/playercards/d010298a-48e7-5eb9-528e-569c44644084/smallart.png',
      'wideArt':
        'https://media.valorant-api.com/playercards/d010298a-48e7-5eb9-528e-569c44644084/wideart.png',
      'wallpaper':
        'https://media.valorant-api.com/playercards/d010298a-48e7-5eb9-528e-569c44644084/largeart.png',
    },
    {
      'id': 'b5314b3f-4532-9e41-bc1f-13954a4c6829',
      'canonicalId': 'b5314b3f-4532-9e41-bc1f-13954a4c6829',
      'kind': 'card',
      'name': 'Unstoppable // Jett Card',
      'image':
        'https://media.valorant-api.com/playercards/b5314b3f-4532-9e41-bc1f-13954a4c6829/smallart.png',
      'wideArt':
        'https://media.valorant-api.com/playercards/b5314b3f-4532-9e41-bc1f-13954a4c6829/wideart.png',
      'wallpaper':
        'https://media.valorant-api.com/playercards/b5314b3f-4532-9e41-bc1f-13954a4c6829/largeart.png',
    },
  ],
  'titles': [
    {
      'id': '25c60422-4246-fe96-9ac1-d88e7a379571',
      'canonicalId': '25c60422-4246-fe96-9ac1-d88e7a379571',
      'kind': 'title',
      'name': 'Unstoppable',
    },
    {
      'id': 'f56d6897-4726-f336-77dc-6f82d2f982f2',
      'canonicalId': 'f56d6897-4726-f336-77dc-6f82d2f982f2',
      'kind': 'title',
      'name': 'In Control',
    },
  ],
  'agents': {
    'Gekko':
      'https://media.valorant-api.com/agents/e370fa57-4757-3604-3648-499e1f642d3f/displayicon.png',
    'Fade':
      'https://media.valorant-api.com/agents/dade69b4-4f5a-8528-247b-219e5a1facd6/displayicon.png',
    'Breach':
      'https://media.valorant-api.com/agents/5f8d3a7f-467b-97f3-062c-13acf203c006/displayicon.png',
    'Deadlock':
      'https://media.valorant-api.com/agents/cc8b64c8-4b25-4ff9-6e7f-37b4da43d235/displayicon.png',
    'Tejo':
      'https://media.valorant-api.com/agents/b444168c-4e35-8076-db47-ef9bf368f384/displayicon.png',
    'Raze':
      'https://media.valorant-api.com/agents/f94c3b30-42be-e959-889c-5aa313dba261/displayicon.png',
    'Chamber':
      'https://media.valorant-api.com/agents/22697a3d-45bf-8dd7-4fec-84a9e28c69d7/displayicon.png',
    'KAY/O':
      'https://media.valorant-api.com/agents/601dbbe7-43ce-be57-2a40-4abd24953621/displayicon.png',
    'Skye':
      'https://media.valorant-api.com/agents/6f2a04ca-43e0-be17-7f36-b3908627744d/displayicon.png',
    'Cypher':
      'https://media.valorant-api.com/agents/117ed9e3-49f3-6512-3ccf-0cada7e3823b/displayicon.png',
    'Sova':
      'https://media.valorant-api.com/agents/320b2a48-4d9b-a075-30f1-1f93a9b638fa/displayicon.png',
    'Miks':
      'https://media.valorant-api.com/agents/7c8a4701-4de6-9355-b254-e09bc2a34b72/displayicon.png',
    'Killjoy':
      'https://media.valorant-api.com/agents/1e58de9c-4950-5125-93e9-a0aee9f98746/displayicon.png',
    'Harbor':
      'https://media.valorant-api.com/agents/95b78ed7-4637-86d9-7e41-71ba8c293152/displayicon.png',
    'Vyse':
      'https://media.valorant-api.com/agents/efba5359-4016-a1e5-7626-b1ae76895940/displayicon.png',
    'Viper':
      'https://media.valorant-api.com/agents/707eab51-4836-f488-046a-cda6bf494859/displayicon.png',
    'Phoenix':
      'https://media.valorant-api.com/agents/eb93336a-449b-9c1b-0a54-a891f7921d69/displayicon.png',
    'Veto':
      'https://media.valorant-api.com/agents/92eeef5d-43b5-1d4a-8d03-b3927a09034b/displayicon.png',
    'Astra':
      'https://media.valorant-api.com/agents/41fb69c1-4189-7b37-f117-bcaf1e96f1bf/displayicon.png',
    'Brimstone':
      'https://media.valorant-api.com/agents/9f0d8ba9-4140-b941-57d3-a7ad57c6b417/displayicon.png',
    'Iso':
      'https://media.valorant-api.com/agents/0e38b510-41a8-5780-5e8f-568b2a4f2d6c/displayicon.png',
    'Clove':
      'https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-daa5eed44993/displayicon.png',
    'Neon':
      'https://media.valorant-api.com/agents/bb2a4828-46eb-8cd1-e765-15848195d751/displayicon.png',
    'Yoru':
      'https://media.valorant-api.com/agents/7f94d92c-4234-0a36-9646-3a87eb8b5c89/displayicon.png',
    'Waylay':
      'https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png',
    'Sage':
      'https://media.valorant-api.com/agents/569fdd95-4d10-43ab-ca70-79becc718b46/displayicon.png',
    'Reyna':
      'https://media.valorant-api.com/agents/a3bfb853-43b2-7238-a4f1-ad90e9e46bcc/displayicon.png',
    'Omen':
      'https://media.valorant-api.com/agents/8e253930-4c05-31dd-1b6c-968525494517/displayicon.png',
    'Jett':
      'https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/displayicon.png',
  },
  'maps': {
    'Ascent': {
      'name': 'Ascent',
      'image':
        'https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/splash.png',
    },
    'Split': {
      'name': 'Split',
      'image':
        'https://media.valorant-api.com/maps/d960549e-485c-e861-8d71-aa9d1aed12a2/splash.png',
    },
    'Fracture': {
      'name': 'Fracture',
      'image':
        'https://media.valorant-api.com/maps/b529448b-4d60-346e-e89e-00a4c527a405/splash.png',
    },
    'Bind': {
      'name': 'Bind',
      'image':
        'https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/splash.png',
    },
    'Skirmish A': {
      'name': 'Skirmish A',
      'image':
        'https://media.valorant-api.com/maps/a9009649-421f-d5d5-f80c-0cbe02c125bb/splash.png',
    },
    'Skirmish B': {
      'name': 'Skirmish B',
      'image':
        'https://media.valorant-api.com/maps/a38a3f9a-4042-844c-8970-a3ac2f7ce93d/splash.png',
    },
    'Skirmish C': {
      'name': 'Skirmish C',
      'image':
        'https://media.valorant-api.com/maps/a264de0f-4a04-9c78-c97a-a6b192ce6e86/splash.png',
    },
    'Skirmish E': {
      'name': 'Skirmish E',
      'image':
        'https://media.valorant-api.com/maps/4490f1d6-4818-bf5f-9b3a-9c9a8dbb52ed/splash.png',
    },
    'Skirmish D': {
      'name': 'Skirmish D',
      'image':
        'https://media.valorant-api.com/maps/1c7555fc-4bc6-3b98-9674-789d47ef6c50/splash.png',
    },
    'Breeze': {
      'name': 'Breeze',
      'image':
        'https://media.valorant-api.com/maps/2fb9a4fd-47b8-4e7d-a969-74b4046ebd53/splash.png',
    },
    'District': {
      'name': 'District',
      'image':
        'https://media.valorant-api.com/maps/690b3ed2-4dff-945b-8223-6da834e30d24/splash.png',
    },
    'Kasbah': {
      'name': 'Kasbah',
      'image':
        'https://media.valorant-api.com/maps/12452a9d-48c3-0b02-e7eb-0381c3520404/splash.png',
    },
    'Drift': {
      'name': 'Drift',
      'image':
        'https://media.valorant-api.com/maps/2c09d728-42d5-30d8-43dc-96a05cc7ee9d/splash.png',
    },
    'Glitch': {
      'name': 'Glitch',
      'image':
        'https://media.valorant-api.com/maps/d6336a5a-428f-c591-98db-c8a291159134/splash.png',
    },
    'Piazza': {
      'name': 'Piazza',
      'image':
        'https://media.valorant-api.com/maps/de28aa9b-4cbe-1003-320e-6cb3ec309557/splash.png',
    },
    'Abyss': {
      'name': 'Abyss',
      'image':
        'https://media.valorant-api.com/maps/224b0a95-48b9-f703-1bd8-67aca101a61f/splash.png',
    },
    'Lotus': {
      'name': 'Lotus',
      'image':
        'https://media.valorant-api.com/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9/splash.png',
    },
    'Sunset': {
      'name': 'Sunset',
      'image':
        'https://media.valorant-api.com/maps/92584fbe-486a-b1b2-9faa-39b0f486b498/splash.png',
    },
    'Basic Training': {
      'name': 'Basic Training',
      'image':
        'https://media.valorant-api.com/maps/1f10dab3-4294-3827-fa35-c2aa00213cf3/splash.png',
    },
    'Pearl': {
      'name': 'Pearl',
      'image':
        'https://media.valorant-api.com/maps/fd267378-4d1d-484f-ff52-77821ed10dc2/splash.png',
    },
    'Summit': {
      'name': 'Summit',
      'image':
        'https://media.valorant-api.com/maps/756da597-416b-c0f2-f47b-afbdf28670bc/splash.png',
    },
    'Icebox': {
      'name': 'Icebox',
      'image':
        'https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9641-8ea21279579a/splash.png',
    },
    'The Range': {
      'name': 'The Range',
      'image':
        'https://media.valorant-api.com/maps/5914d1e0-40c4-cfdd-6b88-eba06347686c/splash.png',
    },
    'Corrode': {
      'name': 'Corrode',
      'image':
        'https://media.valorant-api.com/maps/1c18ab1f-420d-0d8b-71d0-77ad3c439115/splash.png',
    },
    'Haven': {
      'name': 'Haven',
      'image':
        'https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/splash.png',
    },
  },
  'tiers': {
    '0': {
      'name': 'UNRANKED',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/0/largeicon.png',
    },
    '1': {
      'name': 'Unused1',
    },
    '2': {
      'name': 'Unused2',
    },
    '3': {
      'name': 'IRON 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/3/largeicon.png',
    },
    '4': {
      'name': 'IRON 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/4/largeicon.png',
    },
    '5': {
      'name': 'IRON 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/5/largeicon.png',
    },
    '6': {
      'name': 'BRONZE 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/6/largeicon.png',
    },
    '7': {
      'name': 'BRONZE 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/7/largeicon.png',
    },
    '8': {
      'name': 'BRONZE 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/8/largeicon.png',
    },
    '9': {
      'name': 'SILVER 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/9/largeicon.png',
    },
    '10': {
      'name': 'SILVER 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/10/largeicon.png',
    },
    '11': {
      'name': 'SILVER 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/11/largeicon.png',
    },
    '12': {
      'name': 'GOLD 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/12/largeicon.png',
    },
    '13': {
      'name': 'GOLD 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/13/largeicon.png',
    },
    '14': {
      'name': 'GOLD 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/14/largeicon.png',
    },
    '15': {
      'name': 'PLATINUM 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/15/largeicon.png',
    },
    '16': {
      'name': 'PLATINUM 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/16/largeicon.png',
    },
    '17': {
      'name': 'PLATINUM 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/17/largeicon.png',
    },
    '18': {
      'name': 'DIAMOND 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/18/largeicon.png',
    },
    '19': {
      'name': 'DIAMOND 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/19/largeicon.png',
    },
    '20': {
      'name': 'DIAMOND 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/20/largeicon.png',
    },
    '21': {
      'name': 'ASCENDANT 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/21/largeicon.png',
    },
    '22': {
      'name': 'ASCENDANT 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/22/largeicon.png',
    },
    '23': {
      'name': 'ASCENDANT 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/23/largeicon.png',
    },
    '24': {
      'name': 'IMMORTAL 1',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/24/largeicon.png',
    },
    '25': {
      'name': 'IMMORTAL 2',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/25/largeicon.png',
    },
    '26': {
      'name': 'IMMORTAL 3',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/26/largeicon.png',
    },
    '27': {
      'name': 'RADIANT',
      'image':
        'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/27/largeicon.png',
    },
  },
  'skins': {
    'Reaver Vandal': {
      'image':
        'https://media.valorant-api.com/weaponskins/30388628-42f0-606c-82c0-73ad43de997f/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/a6ee2555-4e3a-049e-916a-7ca853dd4568_default_universal.mp4',
      'levels': [
        {
          'id': 'ba42fe63-457a-78ce-4499-47950a698129',
          'name': 'Reaver Vandal',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/ba42fe63-457a-78ce-4499-47950a698129/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/a6ee2555-4e3a-049e-916a-7ca853dd4568_default_universal.mp4',
        },
        {
          'id': '6f9ba692-4618-d0e6-3099-42b4dc5fce89',
          'name': 'Reaver Vandal Level 2',
          'image':
            'https://media.valorant-api.com/weaponskins/30388628-42f0-606c-82c0-73ad43de997f/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/78146b6e-49fc-115d-995e-309c5f18e3fd_default_universal.mp4',
        },
        {
          'id': '98597b95-451c-70cf-46fb-31b4c5a54394',
          'name': 'Reaver Vandal Level 3',
          'image':
            'https://media.valorant-api.com/weaponskins/30388628-42f0-606c-82c0-73ad43de997f/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/b21243ec-4cf0-37c0-43b4-15bf84de9d1d_default_universal.mp4',
        },
        {
          'id': '8c282914-446a-3e99-095a-cd97df201c8b',
          'name': 'Reaver Vandal Level 4',
          'image':
            'https://media.valorant-api.com/weaponskins/30388628-42f0-606c-82c0-73ad43de997f/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/d262fccc-465a-2da6-74ac-049ef3b3f759_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': '2bd28382-48c6-8579-83e8-e9b64b783de3',
          'name': 'Reaver Vandal',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/2bd28382-48c6-8579-83e8-e9b64b783de3/fullrender.png',
        },
        {
          'id': 'b2a065c0-4632-ccaa-f496-7681dc2a6185',
          'name': 'Reaver Vandal Level 4\r\n(Variant 1 Red)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/b2a065c0-4632-ccaa-f496-7681dc2a6185/fullrender.png',
        },
        {
          'id': 'db4461e5-40dd-1173-3b64-e5836f92f4dd',
          'name': 'Reaver Vandal Level 4\r\n(Variant 2 Black)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/db4461e5-40dd-1173-3b64-e5836f92f4dd/fullrender.png',
        },
        {
          'id': 'b2619c1c-4974-4f06-f37b-c68b1d6d7bd1',
          'name': 'Reaver Vandal Level 4\r\n(Variant 3 White)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/b2619c1c-4974-4f06-f37b-c68b1d6d7bd1/fullrender.png',
        },
      ],
      'weaponId': '9c82e19d-4575-0200-1a81-3eacf00cf872',
      'weapon': 'Vandal',
      'collectionKey': 'soulstealer',
    },
    'Spectrum Phantom': {
      'image':
        'https://media.valorant-api.com/weaponskins/980fa063-436e-e51f-c38d-70a5b93a0f1c/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/6ce49b69-45a8-c7bb-865f-6fa6bceeea72_default_universal.mp4',
      'levels': [
        {
          'id': '82db01d1-4192-167b-9f53-78ba374c39ac',
          'name': 'Spectrum Phantom',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/82db01d1-4192-167b-9f53-78ba374c39ac/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/6ce49b69-45a8-c7bb-865f-6fa6bceeea72_default_universal.mp4',
        },
        {
          'id': '8021e6d9-4916-32a9-e2cd-ff9c947a96c5',
          'name': 'Spectrum Phantom Level 2',
          'image':
            'https://media.valorant-api.com/weaponskins/980fa063-436e-e51f-c38d-70a5b93a0f1c/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/fe20185e-43e5-c02e-24cd-97b04179e7ed_default_universal.mp4',
        },
        {
          'id': '831939b1-42e6-6ad3-708b-b58ff2ea64fb',
          'name': 'Spectrum Phantom Level 3',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/831939b1-42e6-6ad3-708b-b58ff2ea64fb/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/bdf22bf1-4ef6-b866-de7e-999ab77007f3_default_universal.mp4',
        },
        {
          'id': '2a744a2b-4dab-71a6-0e2e-7f84d4cf8365',
          'name': 'Spectrum Phantom Level 4',
          'image':
            'https://media.valorant-api.com/weaponskins/980fa063-436e-e51f-c38d-70a5b93a0f1c/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/5e0c9119-42ab-7fb3-b6f6-d081fc77fa2a_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': 'e9014a77-4a74-4ea7-999c-44b0d0f84daa',
          'name': 'Spectrum Phantom',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/e9014a77-4a74-4ea7-999c-44b0d0f84daa/fullrender.png',
        },
        {
          'id': 'e924a97d-46aa-3c3e-ec39-9abfeb811f2b',
          'name': 'Spectrum Phantom Level 4\n(Variant 1 Black)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/e924a97d-46aa-3c3e-ec39-9abfeb811f2b/fullrender.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/2aac289f-433a-3b9e-e7b1-04a0884e8ece_default_universal.mp4',
        },
        {
          'id': '449a0d94-4320-dd8c-d458-fba5fdc04eb0',
          'name': 'Spectrum Phantom Level 4\n(Variant 2 Red)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/449a0d94-4320-dd8c-d458-fba5fdc04eb0/fullrender.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/b0f59fd6-4d87-2dec-60c7-2cb8ba11c721_default_universal.mp4',
        },
        {
          'id': '7e10eabf-476b-0bcb-5847-e8958d6f1132',
          'name': 'Spectrum Phantom Level 4\n(Variant 3 Purple/Pink)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/7e10eabf-476b-0bcb-5847-e8958d6f1132/fullrender.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/16e41132-4a98-c5cb-d067-80b0599b23cc_default_universal.mp4',
        },
      ],
      'weaponId': 'ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a',
      'weapon': 'Phantom',
      'collectionKey': 'atlas',
    },
    'Oni Phantom': {
      'image':
        'https://media.valorant-api.com/weaponskins/36791b03-452d-8dad-0091-898cc28d2196/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/d95f2acb-428c-2abd-3e6c-c2af3806bee9_default_universal.mp4',
      'levels': [
        {
          'id': 'c00e786e-4e6f-0ef7-0ce3-32ba9918ba41',
          'name': 'Oni Phantom',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/c00e786e-4e6f-0ef7-0ce3-32ba9918ba41/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/d95f2acb-428c-2abd-3e6c-c2af3806bee9_default_universal.mp4',
        },
        {
          'id': '2c4e829a-4915-e9d8-5c6f-43a39d60afc0',
          'name': 'Oni Phantom Level 2',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/2c4e829a-4915-e9d8-5c6f-43a39d60afc0/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/f9716000-41f5-8847-8e8e-c7ba525da601_default_universal.mp4',
        },
        {
          'id': 'bb07581b-4733-ce33-53d4-3dadc038ca4a',
          'name': 'Oni Phantom Level 3',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/bb07581b-4733-ce33-53d4-3dadc038ca4a/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/4939d79a-45d5-382a-1a97-208eb7c8766e_default_universal.mp4',
        },
        {
          'id': '1b24255d-4f50-9202-7b6f-f7873db580d1',
          'name': 'Oni Phantom Level 4',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/1b24255d-4f50-9202-7b6f-f7873db580d1/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/23694a4e-4f34-1ba5-d649-dc9a09880d18_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': '6096a66f-43d2-d4ad-6421-84aee3386921',
          'name': 'Oni Phantom',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/6096a66f-43d2-d4ad-6421-84aee3386921/fullrender.png',
        },
        {
          'id': 'b639a920-424b-b855-1e30-7f9b026889f1',
          'name': 'Oni Phantom Level 4\r\n(Variant 1 Kumo)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/b639a920-424b-b855-1e30-7f9b026889f1/fullrender.png',
        },
        {
          'id': '6f9c7109-485a-f2a3-cb1d-9f9a31a995d7',
          'name': 'Oni Phantom Level 4\r\n(Variant 2 Hana)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/6f9c7109-485a-f2a3-cb1d-9f9a31a995d7/fullrender.png',
        },
        {
          'id': '32dfe871-4906-d2ce-4835-2d99aaa52f84',
          'name': 'Oni Phantom Level 4\r\n(Variant 3 Tsubame)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/32dfe871-4906-d2ce-4835-2d99aaa52f84/fullrender.png',
        },
      ],
      'weaponId': 'ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a',
      'weapon': 'Phantom',
      'collectionKey': 'oni',
    },
    'Prime Classic': {
      'image':
        'https://media.valorant-api.com/weaponskins/d653f4a7-4e92-2559-0a97-2c9d46d009b3/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/72d67dd0-0d79-4c98-9e1d-c10068b024a8_default_universal.mp4',
      'levels': [
        {
          'id': 'c7695ce7-4fc9-1c79-64b3-8c8f9e21571c',
          'name': 'Prime Classic',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/c7695ce7-4fc9-1c79-64b3-8c8f9e21571c/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/72d67dd0-0d79-4c98-9e1d-c10068b024a8_default_universal.mp4',
        },
        {
          'id': '7b2c1232-460b-ab9a-1eca-55b5aee9ad08',
          'name': 'Prime Classic Level 2',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/7b2c1232-460b-ab9a-1eca-55b5aee9ad08/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/a670ee4b-a202-4c7f-8021-7e4e11840cff_default_universal.mp4',
        },
        {
          'id': '4fc58223-43e7-a868-a6df-5e93be31369c',
          'name': 'Prime Classic Level 3',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/4fc58223-43e7-a868-a6df-5e93be31369c/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/4c99c871-f3b6-4bcc-87ff-2c83adaac322_default_universal.mp4',
        },
        {
          'id': 'e8a35ddb-4ce7-3867-154c-94803ed12a24',
          'name': 'Prime Classic Level 4',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/e8a35ddb-4ce7-3867-154c-94803ed12a24/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/be82422e-f56b-4a8b-bc1b-b11d8e053618_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': 'd9dce0ec-464c-df67-63a3-1f9a05d322ad',
          'name': 'Prime Classic',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/d9dce0ec-464c-df67-63a3-1f9a05d322ad/fullrender.png',
        },
        {
          'id': '42280760-422f-b5d1-4255-1e8993a817a4',
          'name': 'Prime Classic Level 4\r\n(Variant 1 Orange)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/42280760-422f-b5d1-4255-1e8993a817a4/fullrender.png',
        },
        {
          'id': '02390051-4309-22d4-b733-c09fbfcf2e7f',
          'name': 'Prime Classic Level 4\r\n(Variant 2 Blue)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/02390051-4309-22d4-b733-c09fbfcf2e7f/fullrender.png',
        },
        {
          'id': '9fcc46a1-42f8-6407-787d-cb9d3e0bb718',
          'name': 'Prime Classic Level 4\r\n(Variant 3 Yellow)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/9fcc46a1-42f8-6407-787d-cb9d3e0bb718/fullrender.png',
        },
      ],
      'weaponId': '29a0cfab-485b-f5d5-779a-b59f85e204a8',
      'weapon': 'Classic',
      'collectionKey': 'hypebeast',
    },
    'Sovereign Ghost': {
      'image':
        'https://media.valorant-api.com/weaponskins/a9890917-41ea-eb55-47e7-ee990a87fa4e/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/fd840e0f-6961-4794-900e-8f4350be4679_default_universal.mp4',
      'levels': [
        {
          'id': 'ed8a1109-4e48-f077-636b-e98dd332bfcc',
          'name': 'Sovereign Ghost',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/ed8a1109-4e48-f077-636b-e98dd332bfcc/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/fd840e0f-6961-4794-900e-8f4350be4679_default_universal.mp4',
        },
        {
          'id': '94b4e0f7-454d-0e5b-9f32-4d9fd399d8a2',
          'name': 'Sovereign Ghost Level 2',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/94b4e0f7-454d-0e5b-9f32-4d9fd399d8a2/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/1eccad1f-89ca-4f26-be4d-64bb288c7e84_default_universal.mp4',
        },
        {
          'id': '5aa0593c-40fc-b9c4-9232-7f91f75b9fbd',
          'name': 'Sovereign Ghost Level 3',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/5aa0593c-40fc-b9c4-9232-7f91f75b9fbd/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/d3807099-eafe-4551-8dcd-c9bbbfb5323e_default_universal.mp4',
        },
        {
          'id': 'd5e747da-4d41-28e2-68b2-c5b41584f7cb',
          'name': 'Sovereign Ghost Level 4',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/d5e747da-4d41-28e2-68b2-c5b41584f7cb/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/8adc51e9-a098-4efb-8897-87b3438a7daa_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': 'a84764d9-4f1e-a652-3530-1497e2505285',
          'name': 'Sovereign Ghost',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/a84764d9-4f1e-a652-3530-1497e2505285/fullrender.png',
        },
        {
          'id': '9acf9e55-46b9-5061-f1e7-4fa996fb96c1',
          'name': 'Sovereign Ghost Level 4\r\n(Variant 1 Green)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/9acf9e55-46b9-5061-f1e7-4fa996fb96c1/fullrender.png',
        },
        {
          'id': '357a60e7-431e-f7ad-847e-1da16897b1f7',
          'name': 'Sovereign Ghost Level 4\r\n(Variant 2 Silver)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/357a60e7-431e-f7ad-847e-1da16897b1f7/fullrender.png',
        },
        {
          'id': 'c208e6a1-4bb8-e1d9-6943-848db2aaf3bb',
          'name': 'Sovereign Ghost Level 4\r\n(Variant 3 Purple)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/c208e6a1-4bb8-e1d9-6943-848db2aaf3bb/fullrender.png',
        },
      ],
      'weaponId': '1baa85b4-4c70-1284-64bb-6481dfc3bb4e',
      'weapon': 'Ghost',
      'collectionKey': 'sovereign',
    },
    'Ion Sheriff': {
      'image':
        'https://media.valorant-api.com/weaponskins/83778c03-45a3-67a2-3c89-6b8598327d58/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/aa2185f1-4677-31ed-43e4-b6bec932c597_default_universal.mp4',
      'levels': [
        {
          'id': '2b555f97-46bb-5949-3531-979f5bc817f0',
          'name': 'Ion Sheriff',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/2b555f97-46bb-5949-3531-979f5bc817f0/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/aa2185f1-4677-31ed-43e4-b6bec932c597_default_universal.mp4',
        },
        {
          'id': 'a60421b9-4b86-ccd3-ca08-808ef4cf112b',
          'name': 'Ion Sheriff Level 2',
          'image':
            'https://media.valorant-api.com/weaponskins/83778c03-45a3-67a2-3c89-6b8598327d58/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/f8c2e883-453f-99b2-06b6-5ea30b33b7ac_default_universal.mp4',
        },
        {
          'id': '1ad8e7b3-4547-0890-aa8d-d79be028e48f',
          'name': 'Ion Sheriff Level 3',
          'image':
            'https://media.valorant-api.com/weaponskins/83778c03-45a3-67a2-3c89-6b8598327d58/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/ad9f078e-4088-4e60-71a7-4d8d38027a19_default_universal.mp4',
        },
        {
          'id': 'becd58d6-4da0-db56-a748-35923d2750e1',
          'name': 'Ion Sheriff Level 4',
          'image':
            'https://media.valorant-api.com/weaponskins/83778c03-45a3-67a2-3c89-6b8598327d58/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/21d51f61-43d2-250e-16e8-ab810c2a6907_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': 'd3f81911-44e7-f0c1-cc6c-34bda3bff6d3',
          'name': 'Ion Sheriff',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/d3f81911-44e7-f0c1-cc6c-34bda3bff6d3/fullrender.png',
        },
      ],
      'weaponId': 'e336c6b8-418d-9340-d77f-7a9e4cfe0702',
      'weapon': 'Sheriff',
      'collectionKey': 'oblivion',
    },
    'Reaver Operator': {
      'image':
        'https://media.valorant-api.com/weaponskins/aecab890-43b7-d719-06bc-9295e3d116dc/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/ea996485-496b-c83f-ac73-71b9144326cc_default_universal.mp4',
      'levels': [
        {
          'id': '7bfab387-4e97-d815-4488-c491e3a5520c',
          'name': 'Reaver Operator',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/7bfab387-4e97-d815-4488-c491e3a5520c/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/ea996485-496b-c83f-ac73-71b9144326cc_default_universal.mp4',
        },
        {
          'id': 'bf02e33f-4d16-e361-d1ed-1eb58de846c3',
          'name': 'Reaver Operator Level 2',
          'image':
            'https://media.valorant-api.com/weaponskins/aecab890-43b7-d719-06bc-9295e3d116dc/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/3c3c69e2-4bb1-7188-1002-f988ab0db603_default_universal.mp4',
        },
        {
          'id': '59409cb0-4583-20a4-c905-4db393712af7',
          'name': 'Reaver Operator Level 3',
          'image':
            'https://media.valorant-api.com/weaponskins/aecab890-43b7-d719-06bc-9295e3d116dc/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/a66f510e-4c04-b495-67cf-a8bde5d8fb4a_default_universal.mp4',
        },
        {
          'id': '21305a72-4374-67c7-c25b-e0bb8dc2da52',
          'name': 'Reaver Operator Level 4',
          'image':
            'https://media.valorant-api.com/weaponskins/aecab890-43b7-d719-06bc-9295e3d116dc/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/245283ef-493b-4f79-a9fb-30a3075fffe0_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': '27865910-4dd4-845f-8671-92988cc1c996',
          'name': 'Reaver Operator',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/27865910-4dd4-845f-8671-92988cc1c996/fullrender.png',
        },
        {
          'id': '0b29f645-404f-f9d2-2165-c6bf5b16572f',
          'name': 'Reaver Operator Level 4\r\n(Variant 1 Red)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/0b29f645-404f-f9d2-2165-c6bf5b16572f/fullrender.png',
        },
        {
          'id': '319d9f49-46a9-be17-9b08-cfb1a766fa37',
          'name': 'Reaver Operator Level 4\r\n(Variant 2 Black)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/319d9f49-46a9-be17-9b08-cfb1a766fa37/fullrender.png',
        },
        {
          'id': '4244d37b-4129-175d-a2dc-98a8e1de89c6',
          'name': 'Reaver Operator Level 4\r\n(Variant 3 White)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/4244d37b-4129-175d-a2dc-98a8e1de89c6/fullrender.png',
        },
      ],
      'weaponId': 'a03b24d3-4319-996d-0f8c-94bbfba1dfc7',
      'weapon': 'Operator',
      'collectionKey': 'soulstealer',
    },
    'RGX 11z Pro Blade': {
      'image':
        'https://media.valorant-api.com/weaponskins/9fb366b6-46df-a722-0cf2-9c9b85936f17/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/ff91070b-4b02-e569-2fa3-41b3eb8cdfde_default_universal.mp4',
      'levels': [
        {
          'id': 'a1762ed3-45bf-2dd5-776f-a18a33171e6f',
          'name': 'RGX 11z Pro Blade',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/a1762ed3-45bf-2dd5-776f-a18a33171e6f/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/ff91070b-4b02-e569-2fa3-41b3eb8cdfde_default_universal.mp4',
        },
        {
          'id': 'd67af30b-4b2a-b1e6-3ac2-6aba74b885d4',
          'name': 'RGX 11z Pro Blade Level 2',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/d67af30b-4b2a-b1e6-3ac2-6aba74b885d4/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/99d27d45-4e1f-75ba-df79-c18f1b610628_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': '8ceded3e-4365-9aa6-eb7e-bda2cd553d6f',
          'name': 'RGX 11z Pro Blade',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/8ceded3e-4365-9aa6-eb7e-bda2cd553d6f/fullrender.png',
        },
        {
          'id': 'bcd0308b-4f12-e460-e34c-dba6b25386df',
          'name': 'RGX 11z Pro Blade Level 2\r\n(Variant 1 Red)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/bcd0308b-4f12-e460-e34c-dba6b25386df/fullrender.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/5e7eae63-4ddd-9859-fdd9-1d894313c62a_default_universal.mp4',
        },
        {
          'id': '5a902162-4810-106a-6fc6-87a0318d73d2',
          'name': 'RGX 11z Pro Blade Level 2\r\n(Variant 2 Blue)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/5a902162-4810-106a-6fc6-87a0318d73d2/fullrender.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/fd579859-431a-07fc-df3a-f996b89cbc7b_default_universal.mp4',
        },
        {
          'id': '05029e79-4c74-85c3-30ee-78ab3179b600',
          'name': 'RGX 11z Pro Blade Level 2\r\n(Variant 3 Yellow)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/05029e79-4c74-85c3-30ee-78ab3179b600/fullrender.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/feda7ab0-4c93-87be-f3a3-d88b4fdab039_default_universal.mp4',
        },
      ],
      'weaponId': '2f59173c-4bed-b6c3-2191-dea9b58be9c7',
      'weapon': 'Melee',
      'collectionKey': 'afterglow',
    },
    'Prime Vandal': {
      'weaponId': '9c82e19d-4575-0200-1a81-3eacf00cf872',
      'weapon': 'Vandal',
      'collectionKey': 'hypebeast',
      'levels': [
        {
          'id': 'c9678d8c-4327-f397-b0ec-dca3c3d6fb15',
          'name': 'Prime Vandal',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/c9678d8c-4327-f397-b0ec-dca3c3d6fb15/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/d9fe3b9b-6d9e-451f-84bd-b85d7f91a106_default_universal.mp4',
        },
        {
          'id': 'c6f9c7ef-4a35-fa14-c9ed-bd80e37be826',
          'name': 'Prime Vandal Level 2',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/c6f9c7ef-4a35-fa14-c9ed-bd80e37be826/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/b3ac314b-100a-4822-8464-e0c861ca9171_default_universal.mp4',
        },
        {
          'id': 'fc332008-475f-5555-0155-4cb3bce714ff',
          'name': 'Prime Vandal Level 3',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/fc332008-475f-5555-0155-4cb3bce714ff/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/3dce5c84-8554-4fba-aaa1-af725779014c_default_universal.mp4',
        },
        {
          'id': '22821a32-4e04-ad4a-1893-95904c08b264',
          'name': 'Prime Vandal Level 4',
          'image':
            'https://media.valorant-api.com/weaponskinlevels/22821a32-4e04-ad4a-1893-95904c08b264/displayicon.png',
          'video':
            'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/97f7aa62-ede2-4e34-b5f8-efa798be6e86_default_universal.mp4',
        },
      ],
      'chromas': [
        {
          'id': 'a26e0d1d-4886-7d62-6b4f-1996e706463d',
          'name': 'Prime Vandal',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/a26e0d1d-4886-7d62-6b4f-1996e706463d/fullrender.png',
        },
        {
          'id': 'ad2b0b8b-4da8-9c88-331a-028f2026ab66',
          'name': 'Prime Vandal Level 4\r\n(Variant 1 Orange)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/ad2b0b8b-4da8-9c88-331a-028f2026ab66/fullrender.png',
        },
        {
          'id': 'cd3ebdc1-4858-efda-6cee-c683726f8ca9',
          'name': 'Prime Vandal Level 4\r\n(Variant 2 Blue)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/cd3ebdc1-4858-efda-6cee-c683726f8ca9/fullrender.png',
        },
        {
          'id': 'd43b8d21-4fb2-1224-1392-53ab6d829ed1',
          'name': 'Prime Vandal Level 4\r\n(Variant 3 Yellow)',
          'image':
            'https://media.valorant-api.com/weaponskinchromas/d43b8d21-4fb2-1224-1392-53ab6d829ed1/fullrender.png',
        },
      ],
      'image':
        'https://media.valorant-api.com/weaponskins/b9ee2457-481c-6776-3f5b-0ca8e8f90c89/displayicon.png',
      'video':
        'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/d9fe3b9b-6d9e-451f-84bd-b85d7f91a106_default_universal.mp4',
    },
  },
  'bundles': {
    '2116a38e-4b71-f169-0d16-ce9289af4bfa': {
      'name': 'Prime',
      'image':
        'https://media.valorant-api.com/bundles/2116a38e-4b71-f169-0d16-ce9289af4bfa/displayicon.png',
    },
    '790f52c4-4ed8-9869-fa8b-bf92fc24b441': {
      'name': 'Ion',
      'image':
        'https://media.valorant-api.com/bundles/790f52c4-4ed8-9869-fa8b-bf92fc24b441/displayicon.png',
    },
    '693d675e-4ed2-c00a-5e38-6b859b275565': {
      'name': 'Ion',
      'image':
        'https://media.valorant-api.com/bundles/693d675e-4ed2-c00a-5e38-6b859b275565/displayicon.png',
    },
    'b7d754d4-44aa-4663-afc3-84a5cccc3c9d': {
      'name': 'Oni',
      'image':
        'https://media.valorant-api.com/bundles/b7d754d4-44aa-4663-afc3-84a5cccc3c9d/displayicon.png',
    },
    'ebfb909d-45ba-c514-3369-55bf014ba293': {
      'name': 'Oni',
      'image':
        'https://media.valorant-api.com/bundles/ebfb909d-45ba-c514-3369-55bf014ba293/displayicon.png',
    },
    'fde33d91-4bbd-ee1d-3c2b-40af0fe0e510': {
      'name': 'Reaver',
      'image':
        'https://media.valorant-api.com/bundles/fde33d91-4bbd-ee1d-3c2b-40af0fe0e510/displayicon.png',
    },
    'f7dcf7e1-485e-0524-ec82-0d97b2c8b40b': {
      'name': 'Reaver',
      'image':
        'https://media.valorant-api.com/bundles/f7dcf7e1-485e-0524-ec82-0d97b2c8b40b/displayicon.png',
    },
    '81d85522-4651-4f66-72de-5fa057b3514c': {
      'name': 'Reaver',
      'image':
        'https://media.valorant-api.com/bundles/81d85522-4651-4f66-72de-5fa057b3514c/displayicon.png',
    },
  },
};
