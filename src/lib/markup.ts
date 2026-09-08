import type { PreparedImage } from "./imageAttachment";

/** A point on the viewer, in CSS pixels relative to it. */
export interface MarkPoint {
  x: number;
  y: number;
}

/**
 * One thing drawn on top of the model.
 *
 * All of it lives in screen space, because there is no reliable way to anchor a mark to the
 * geometry underneath it — see the notes on the viewer's projection APIs. That's why markup
 * holds the camera still: a mark that means "this bit" stops meaning anything the moment the
 * model turns beneath it.
 */
export type Mark =
  | { kind: "region"; points: MarkPoint[] }
  | { kind: "arrow"; from: MarkPoint; to: MarkPoint }
  | { kind: "note"; at: MarkPoint; text: string };

export const MARKUP_COLOR = "#ff2d78";
/** Lifts the chosen area out of the picture without hiding anything around it. */
export const REGION_FILL = "rgba(255, 255, 255, 0.17)";

const MAX_EDGE = 1200;
const QUALITY = 0.82;

/** The notes, in the order their pins are numbered, so the text and the picture agree. */
export function noteTexts(marks: Mark[]): string[] {
  return marks.filter((mark): mark is Extract<Mark, { kind: "note" }> => mark.kind === "note")
    .map((mark) => mark.text);
}

/**
 * The view as it stands, with every mark drawn onto it.
 *
 * The whole frame, never a crop: a cut-out of a grey curve says nothing, while the same curve
 * ringed on the whole object says "the handle". The agent already has the code — what it
 * can't know is which part of the object was meant.
 */
export async function renderMarkup(
  snapshot: string,
  marks: Mark[],
  viewWidth: number,
  viewHeight: number,
): Promise<PreparedImage | null> {
  if (!marks.length || viewWidth <= 0 || viewHeight <= 0) return null;

  const source = await loadDataUrl(snapshot);
  if (!source) return null;

  // The viewer's canvas is device-pixel scaled, so marks measured in CSS pixels have to be
  // scaled onto it before anything lines up.
  const toSource = source.width / viewWidth;
  const fit = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const k = toSource * fit;

  const width = Math.max(1, Math.round(source.width * fit));
  const height = Math.max(1, Math.round(source.height * fit));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  // JPEG has no transparency and the viewer paints on some — without this the model lands on
  // black and the grid disappears with it.
  context.fillStyle = "#0b0e14";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  const weight = Math.max(2, Math.round(width / 240));
  context.lineJoin = "round";
  context.lineCap = "round";

  let noteNumber = 0;
  for (const mark of marks) {
    if (mark.kind === "region") drawRegion(context, mark.points, k, weight);
    else if (mark.kind === "arrow") drawArrow(context, mark.from, mark.to, k, weight);
    else drawNotePin(context, mark.at, k, weight, ++noteNumber);
  }

  const encoded = canvas.toDataURL("image/jpeg", QUALITY);
  return {
    data: encoded.slice(encoded.indexOf(",") + 1),
    mediaType: "image/jpeg",
    previewUrl: encoded,
    kind: "region",
  };
}

function drawRegion(
  context: CanvasRenderingContext2D,
  points: MarkPoint[],
  k: number,
  weight: number,
) {
  if (points.length < 3) return;

  const shape = new Path2D();
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x * k, point.y * k);
    else shape.lineTo(point.x * k, point.y * k);
  });
  shape.closePath();

  context.fillStyle = REGION_FILL;
  context.fill(shape);
  context.strokeStyle = MARKUP_COLOR;
  context.lineWidth = weight;
  context.stroke(shape);
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: MarkPoint,
  to: MarkPoint,
  k: number,
  weight: number,
) {
  const x1 = from.x * k;
  const y1 = from.y * k;
  const x2 = to.x * k;
  const y2 = to.y * k;

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(10, weight * 5);

  context.strokeStyle = MARKUP_COLOR;
  context.fillStyle = MARKUP_COLOR;
  context.lineWidth = weight;

  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();

  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  context.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

function drawNotePin(
  context: CanvasRenderingContext2D,
  at: MarkPoint,
  k: number,
  weight: number,
  number: number,
) {
  const x = at.x * k;
  const y = at.y * k;
  const radius = Math.max(11, weight * 6);

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = MARKUP_COLOR;
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1.5, weight / 2);
  context.stroke();

  // The pin carries only its number; the words travel as text, where they can't be misread.
  context.fillStyle = "#ffffff";
  context.font = `bold ${Math.round(radius * 1.25)}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number), x, y + radius * 0.05);
}

function loadDataUrl(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
