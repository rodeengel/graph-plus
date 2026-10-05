/** Shared visual composition; authored colors and settings remain unchanged. */
export function clampOpacity(value: number, fallback = 1): number {
  const alpha = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 1;
  return Math.max(0, Math.min(1, alpha));
}

const colorCache = new Map<string, string>();
const CACHE_LIMIT = 512;

/**
 * 1 preserves the supplied color exactly. Below 1, scale its sRGB channels
 * toward black; above 1, blend them toward white, up to 50 percent at 2.
 * Both transformations raise/lower luminance without changing opacity and
 * retain hue in practical graph colors instead of clipping channels apart.
 * Graph color pickers author hex colors; other CSS colors remain intact.
 */
export function getAppearanceColor(color: string, brightness: number): string {
  const amount = Number.isFinite(brightness) ? Math.max(0, Math.min(2, brightness)) : 1;
  if (amount === 1) return color;
  const key = `${color}:${amount}`;
  const cached = colorCache.get(key);
  if (cached !== undefined) return cached;
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = match[1].length === 3 ? [...match[1]].map((channel) => channel + channel).join("") : match[1];
  let result = "#";
  for (let index = 0; index < 6; index += 2) {
    const channel = parseInt(hex.slice(index, index + 2), 16);
    const adjusted = amount < 1 ? channel * amount : channel + (255 - channel) * (amount - 1) / 2;
    result += Math.round(adjusted).toString(16).padStart(2, "0");
  }
  if (colorCache.size >= CACHE_LIMIT) colorCache.delete(colorCache.keys().next().value!);
  colorCache.set(key, result);
  return result;
}
