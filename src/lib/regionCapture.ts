import type { PreparedImage } from "./imageAttachment";

/** A point on the lasso, in CSS pixels relative to the viewer. */
export interface LassoPoint {
  x: number;
  y: number;
}

const MAX_EDGE = 1200;
const QUALITY = 0.82;

/** Bright enough to read against a grey model, a colored one, and the dark grid alike. */
const LASSO_COLOR = "#ff2d78";
/** Enough to say "this part", not so much that the rest stops being recognizable. */
const OUTSIDE_DIM = "rgba(6, 8, 12, 0.55)";

/**
 * The whole view with a region marked on it — not a crop of the region.
 *
 * A cut-out of a grey curve tells you nothing; the same curve circled on the whole object
 * tells you it's the handle. The agent already has the code, so what it's missing is which
 * part of the object you meant, and that's only answerable in context.
 */
export async function captureRegion(
  snapshot: string,
  path: LassoPoint[],
  viewWidth: number,
  viewHeight: number,
): Promise<PreparedImage | null> {
  if (path.length < 3 || viewWidth <= 0 || viewHeight <= 0) return null;

  const source = await loadDataUrl(snapshot);
  if (!source) return null;

  // The viewer's canvas is device-pixel scaled, so the lasso — measured in CSS pixels — has
  // to be scaled onto it before anything lines up.
  const toSource = source.width / viewWidth;
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  // JPEG has no transparency, and the viewer paints on one — without this the model would
  // land on black and lose the grid entirely.
  context.fillStyle = "#0b0e14";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  const shape = new Path2D();
  path.forEach((point, index) => {
    const x = point.x * toSource * scale;
    const y = point.y * toSource * scale;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  // Dim everything outside the loop by filling the whole frame and the loop together with
  // the even-odd rule, which leaves the inside untouched.
  const outside = new Path2D();
  outside.rect(0, 0, width, height);
  outside.addPath(shape);
  context.fillStyle = OUTSIDE_DIM;
  context.fill(outside, "evenodd");

  context.strokeStyle = LASSO_COLOR;
  context.lineWidth = Math.max(2, Math.round(width / 220));
  context.lineJoin = "round";
  context.stroke(shape);

  const encoded = canvas.toDataURL("image/jpeg", QUALITY);
  return {
    data: encoded.slice(encoded.indexOf(",") + 1),
    mediaType: "image/jpeg",
    previewUrl: encoded,
    kind: "region",
  };
}

function loadDataUrl(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
