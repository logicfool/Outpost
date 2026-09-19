const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('expo/config-plugins');
const fs = require('node:fs/promises'),
  path = require('node:path');
const SERVICE = 'app.outpost.historysync.OutpostHistorySyncService';
function withHistorySync(config) {
  config = withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m['uses-permission'] ??= [];
    for (const name of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.WAKE_LOCK',
      'android.permission.POST_NOTIFICATIONS',
    ])
      if (!m['uses-permission'].some((p) => p.$?.['android:name'] === name))
        m['uses-permission'].push({ $: { 'android:name': name } });
    const app = m.application?.[0];
    if (!app) throw Error('Android application manifest missing');
    app.service ??= [];
    const service = app.service.find((s) => s.$?.['android:name'] === SERVICE);
    const attrs = {
      'android:name': SERVICE,
      'android:exported': 'false',
      'android:foregroundServiceType': 'dataSync',
      'android:stopWithTask': 'true',
    };
    if (service) service.$ = { ...service.$, ...attrs };
    else app.service.push({ $: attrs });
    return c;
  });
  config = withMainApplication(config, (c) => {
    const call = 'app.outpost.historysync.OutpostHistorySyncPackage.install(this)';
    if (c.modResults.contents.includes(call)) return c;
    const anchor = 'PackageList(this).packages.apply {';
    if (!c.modResults.contents.includes(anchor))
      throw Error('Unsupported MainApplication template for history sync');
    c.modResults.contents = c.modResults.contents.replace(anchor, anchor + '\n          ' + call);
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const from = path.join(c.modRequest.projectRoot, 'native/history-sync/android'),
        to = path.join(
          c.modRequest.platformProjectRoot,
          'app/src/main/java/app/outpost/historysync',
        );
      await fs.mkdir(to, { recursive: true });
      for (const name of [
        'HistorySyncPolicy.java',
        'OutpostHistorySyncPackage.java',
        'OutpostHistorySyncModule.java',
        'OutpostHistorySyncService.java',
      ])
        await fs.copyFile(path.join(from, name), path.join(to, name));
      return c;
    },
  ]);
}
module.exports = withHistorySync;
