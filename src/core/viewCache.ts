/** Pure view derivations, cached by immutable input identity without extending its lifetime. */
const styles = new WeakMap<Function, WeakMap<object, unknown>>();
export function sharedViewStyles<P extends object, T>(factory: (palette: P) => T, palette: P): T {
  let palettes = styles.get(factory);
  if (!palettes) {
    palettes = new WeakMap();
    styles.set(factory, palettes);
  }
  if (!palettes.has(palette)) palettes.set(palette, factory(palette));
  return palettes.get(palette) as T;
}
