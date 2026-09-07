/**
 * Prepares a photo for the design agent.
 *
 * Phone photos are many megabytes and far larger than the model needs, so we downscale in
 * the browser before upload: it keeps the request small, the wait short and the cost down.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Rejected before we bother decoding — a friendlier failure than an out-of-memory tab. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Claude sees no extra detail beyond ~1568px, so anything larger is wasted upload. */
const MAX_EDGE = 1200;

export interface PreparedImage {
  /** Base64 payload, no data: prefix — the shape the Anthropic API wants. */
  data: string;
  mediaType: "image/jpeg";
  /** data: URL for showing the thumbnail in the composer. */
  previewUrl: string;
}

export type PrepareResult = { ok: true; image: PreparedImage } | { ok: false; error: string };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    image.src = url;
  });
}

export async function prepareImage(file: File): Promise<PrepareResult> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, error: "That file isn't a picture I can read. Try a PNG, JPG or WEBP!" };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { ok: false, error: "That picture is really big. Try a smaller one!" };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    return { ok: false, error: "I couldn't open that picture. Try a different one!" };
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return { ok: false, error: "I couldn't open that picture. Try a different one!" };

  // JPEG has no transparency, so paint white first — otherwise cut-out PNGs turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const previewUrl = canvas.toDataURL("image/jpeg", 0.85);
  return {
    ok: true,
    image: { data: previewUrl.slice(previewUrl.indexOf(",") + 1), mediaType: "image/jpeg", previewUrl },
  };
}
