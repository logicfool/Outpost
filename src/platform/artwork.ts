import { clearArtworkMemory } from '../core/artworkMemory';
import { Image } from 'expo-image';
import { safeImage } from '../core/validation';
const recent = new Map<string, number>();

export function warmArtwork(urls: string[]): () => void {
  let stopped = false,
    index = 0;
  const queue = [...new Set(urls)]
    .filter((url) => safeImage(url) && (recent.get(url) ?? 0) < Date.now())
    .slice(0, 16);
  const worker = async () => {
    while (!stopped && index < queue.length) {
      const url = queue[index++]!;
      recent.set(url, Date.now() + 60000);
      try {
        if (await Image.prefetch(url, { cachePolicy: 'memory-disk' }))
          recent.set(url, Date.now() + 3600000);
        else recent.delete(url);
      } catch {
        recent.delete(url);
      }
      if (recent.size > 128) recent.delete(recent.keys().next().value!);
    }
  };
  void worker();
  void worker();
  return () => {
    stopped = true;
  };
}
export async function clearArtworkCache() {
  clearArtworkMemory();
  recent.clear();
  await Image.clearMemoryCache();
  await Image.clearDiskCache();
}
