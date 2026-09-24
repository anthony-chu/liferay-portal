/**
 * Is a hex color the color the prompt asked for?
 *
 * Stated as hue / saturation / lightness bands, because that is the vocabulary the
 * question is actually in — "deep navy" is a hue range that is dark and not grey. The
 * bands are the specification: read them, disagree with them, change the numbers.
 *
 * Channel arithmetic was tried first and abandoned. Fixed offsets (`b > g + 20`) reject
 * the darkest navies, since channel gaps compress as a color gets darker; ratios instead
 * sprawled across 5% of all color space, from cyan to purple and up to lightness 0.54.
 */

const channels = (hex: string) => {
    const match = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);

    if (!match) {
        return null;
    }

    // #036 means #003366. Liferay's own tokens use the short form (`--btn-primary-color: #fff`).
    const digits =
        match[1].length === 3 ? match[1].replace(/./g, (digit) => digit + digit) : match[1];

    const value = parseInt(digits, 16);

    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

/** Hue in degrees, saturation and lightness as 0..1. */
const toHsl = (hex: string) => {
    const rgb = channels(hex);

    if (!rgb) {
        return null;
    }

    const [r, g, b] = rgb.map((channel) => channel / 255);

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    const delta = max - min;
    const l = (max + min) / 2;

    if (delta === 0) {
        return { h: 0, l, s: 0 };
    }

    const s = delta / (1 - Math.abs(2 * l - 1));

    const h =
        max === r
            ? 60 * (((g - b) / delta) % 6)
            : max === g
              ? 60 * ((b - r) / delta + 2)
              : 60 * ((r - g) / delta + 4);

    return { h: (h + 360) % 360, l, s };
};

const within = (hex: string, hue: [number, number], lightness: [number, number], minSaturation: number) => {
    const hsl = toHsl(hex);

    if (!hsl) {
        return false;
    }

    return (
        hsl.h >= hue[0] &&
        hsl.h <= hue[1] &&
        hsl.l >= lightness[0] &&
        hsl.l <= lightness[1] &&
        hsl.s >= minSaturation
    );
};

/** Blue through indigo, dark, and saturated enough not to read as slate grey. */
export const isDeepNavy = (hex: string) => within(hex, [205, 250], [0.06, 0.36], 0.2);

/** Orange-gold, mid-light, saturated — excludes terracotta below, yellow above. */
export const isAmber = (hex: string) => within(hex, [30, 52], [0.35, 0.7], 0.5);
