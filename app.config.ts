import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  owner: 'logicfool',
  name: 'Outpost',
  slug: 'outpost-valorant',
  version: '0.2.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  scheme: 'outpost',
  ios: {
    bundleIdentifier: 'app.outpost.valorant',
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['processing'],
      BGTaskSchedulerPermittedIdentifiers: ['com.expo.modules.backgroundtask.processing'],
    },
  },
  android: { package: 'app.outpost.valorant', allowBackup: false },
  plugins: [
    ['expo-secure-store', { configureAndroidBackup: true }],
    'expo-sqlite',
    'expo-notifications',
    'expo-background-task',
    'expo-status-bar',
    'expo-video',
  ],
  web: { bundler: 'metro', name: 'Outpost demo' },
  extra: {
    experimentalRiotClientAccess: true,
    dataMode: 'local-first',
    eas: { projectId: '1513294e-122e-4886-9d4b-0cace0e240e4' },
  },
};
export default config;
