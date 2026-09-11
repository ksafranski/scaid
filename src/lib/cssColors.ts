/**
 * Every colour CSS knows by name.
 *
 * A program that colours by name can use any of these, and OpenSCAD resolves them the same
 * way the browser does — so the picker may as well offer the lot rather than whichever
 * handful the agent happened to list beside the setting.
 *
 * Only the names are kept. What each one looks like is the browser's business, and asking it
 * is both shorter than a table of numbers and guaranteed to match what OpenSCAD renders.
 */
export const CSS_COLOR_NAMES = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue",
  "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green",
  "greenyellow", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki",
  "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
  "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightpink",
  "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightsteelblue",
  "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab",
  "orange", "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise",
  "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue",
  "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon",
  "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue",
  "slategray", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato",
  "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
] as const;

export type CssColorName = (typeof CSS_COLOR_NAMES)[number];

/**
 * The same names, ordered so a grid of them reads as a spectrum.
 *
 * Alphabetical is the wrong order for choosing a colour — it scatters every red across the
 * list. Sorted by hue the greys collect at the front and the rest runs round the wheel, so
 * finding "a slightly deeper blue than that one" is a matter of looking next to it.
 *
 * Needs a browser, since what each name looks like is the browser's to say.
 */
export function byHue(resolve: (name: string) => [number, number, number] | null): string[] {
  const measured = CSS_COLOR_NAMES.map((name) => {
    const rgb = resolve(name);
    if (!rgb) return { name, hue: 0, saturation: -1, lightness: 0 };

    const [r, g, b] = rgb;
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    const span = high - low;

    let hue = 0;
    if (span > 0) {
      if (high === r) hue = ((g - b) / span) % 6;
      else if (high === g) hue = (b - r) / span + 2;
      else hue = (r - g) / span + 4;
      hue = (hue * 60 + 360) % 360;
    }

    return { name, hue, saturation: span, lightness: (high + low) / 2 };
  });

  const grey = measured.filter((entry) => entry.saturation < 0.08);
  const coloured = measured.filter((entry) => entry.saturation >= 0.08);

  grey.sort((a, b) => a.lightness - b.lightness);
  coloured.sort((a, b) => a.hue - b.hue || a.lightness - b.lightness);

  return [...grey, ...coloured].map((entry) => entry.name);
}
