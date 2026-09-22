import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export function selectionTick(): void {
  if (Platform.OS !== 'ios') return;
  void Haptics.selectionAsync().catch(() => {});
}
