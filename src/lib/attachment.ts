/**
 * Prepares something someone attached, for the design agent.
 *
 * Three sorts of thing arrive here and they need different handling. A photo is downscaled
 * in the browser, because phone photos are many megabytes and far larger than the model
 * needs — it keeps the request small, the wait short and the cost down. A PDF goes up as
 * it is, since taking it apart in the browser would lose the pictures that are usually the
 * reason for sending one. Anything written is read as text, which is both smaller and
 * clearer than a picture of the same words.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** What the file picker offers. Extensions as well as types, because a .md often has neither. */
export const ACCEPTED_ATTACHMENTS = [
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".json",
].join(",");

/**
 * How large a PDF may be before it's turned away.
 *
 * Base64 costs a third on top, and the whole request body has to stay under the 4.5MB a
 * serverless function will accept — so 2MB of PDF is about 2.7MB on the wire, which leaves
 * room for the prompt and the current program beside it. Plenty for a datasheet; not
 * enough for a scanned book, which is the right place to draw it.
 */
const MAX_PDF_BYTES = 2 * 1024 * 1024;

/** Far more than anyone pastes in a spec, and short of the size where it crowds the prompt. */
const MAX_TEXT_CHARS = 100_000;

/** Rejected before we bother decoding — a friendlier failure than an out-of-memory tab. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Claude sees no extra detail beyond ~1568px, so anything larger is wasted upload. */
const MAX_EDGE = 1200;

/**
 * What we aim the encoded payload to come in under.
 *
 * Vercel rejects a request body over 4.5MB with a 413 before the route can respond, so the
 * fix has to happen here rather than server-side. 1.5MB of base64 is roughly 1.1MB of image
 * — far more than a 1200px photo needs, and a third of the budget at worst.
 */
const TARGET_BASE64_BYTES = 1_500_000;

/**
 * Encoding attempts, largest first. A normal photo is done on the first one; the rest exist
 * for the unusual image that stays huge at 1200px — dense texture, noise, a screenshot of
 * text — where quality matters less than getting it sent at all.
 */
const ATTEMPTS = [
  { edge: MAX_EDGE, quality: 0.85 },
  { edge: MAX_EDGE, quality: 0.7 },
  { edge: 1000, quality: 0.7 },
  { edge: 800, quality: 0.65 },
  { edge: 640, quality: 0.6 },
] as const;

export interface PreparedImage {
  form: "image";
  /** Base64 payload, no data: prefix — the shape the Anthropic API wants. */
  data: string;
  mediaType: "image/jpeg";
  /** data: URL for showing the thumbnail in the composer. */
  previewUrl: string;
  /** What to call it on screen. */
  name: string;
  /**
   * What the picture is *for*, which changes how the agent should read it.
   *
   * A reference photo is the thing to build. A region capture is the model it already
   * made, with part of it circled — building that would be nonsense. 'current' is the same
   * model with no marks on it, sent automatically so the words have something to point at.
   */
  kind: "reference" | "region" | "current";
}

export interface PreparedDocument {
  form: "document";
  /** Base64 for a PDF; the words themselves for anything written. */
  data: string;
  mediaType: "application/pdf" | "text/plain";
  name: string;
  kind: "reference";
}

export type PreparedAttachment = PreparedImage | PreparedDocument;

export type PrepareResult =
  | { ok: true; attachment: PreparedAttachment }
  | { ok: false; error: string };

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

function encode(image: HTMLImageElement, edge: number, quality: number): string | null {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  // JPEG has no transparency, so paint white first — otherwise cut-out PNGs turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

/** Whether a file is written material, by type when the browser gives one and by name when it doesn't. */
function isText(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  // A .md picked from disk frequently arrives with an empty type, or as something the
  // browser guessed. The extension is the more reliable signal for exactly these.
  return /\.(md|markdown|txt|csv|json|log)$/i.test(file.name);
}

/**
 * What the browser calls an image it put on the clipboard itself.
 *
 * A screenshot has no filename, so Chrome and Safari both invent this one. Copying an
 * actual file in Finder keeps its real name, which is worth showing — so only the invented
 * name gets replaced.
 */
const PLACEHOLDER_NAME = /^image\.(png|jpe?g|webp|gif)$/i;

/**
 * The image on the clipboard, if taking it is what someone meant by pasting.
 *
 * Text wins when there is any, because a clipboard can hold both — copying a cell out of a
 * spreadsheet offers a picture of it as well as the words — and in that case the words are
 * what was asked for. A screenshot carries no text, which is the case this exists for.
 */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  if (data.getData("text/plain").trim()) return null;

  for (const file of Array.from(data.files)) {
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) continue;
    if (!file.name || PLACEHOLDER_NAME.test(file.name)) {
      const extension = file.type.replace("image/", "").replace("jpeg", "jpg");
      return new File([file], `Pasted picture.${extension}`, { type: file.type });
    }
    return file;
  }
  return null;
}

/** Reads what someone attached into the shape the agent can be handed. */
export async function prepareAttachment(file: File): Promise<PrepareResult> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return preparePdf(file);
  }
  if (isText(file)) return prepareText(file);
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return prepareImage(file);
  }
  return {
    ok: false,
    error: "I can read pictures, PDFs and written notes. That one isn't something I can open.",
  };
}

async function preparePdf(file: File): Promise<PrepareResult> {
  if (file.size > MAX_PDF_BYTES) {
    return { ok: false, error: "That PDF is too big to send. Try one under 2MB, or just the pages that matter." };
  }

  let data: string;
  try {
    data = await base64Of(file);
  } catch {
    return { ok: false, error: "I couldn't open that PDF. Try a different one." };
  }

  return {
    ok: true,
    attachment: { form: "document", data, mediaType: "application/pdf", name: file.name, kind: "reference" },
  };
}

async function prepareText(file: File): Promise<PrepareResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "I couldn't read that file. Try a different one." };
  }

  if (!text.trim()) return { ok: false, error: "That file is empty." };

  // Cut rather than refuse: the top of a long document is nearly always the part that
  // says what the thing is, and losing the end beats losing the attachment.
  const data =
    text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[…the rest of this file was too long to send]`
      : text;

  return {
    ok: true,
    attachment: { form: "document", data, mediaType: "text/plain", name: file.name, kind: "reference" },
  };
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * How large the automatic screenshot is sent.
 *
 * Smaller than a photo, because it doesn't need to be big: it is one clean object on a
 * plain background, and its whole job is to give "the handle" something to point at. It
 * rides along with every follow-up, so its size is a tax on every turn rather than on the
 * rare one where someone attaches something.
 */
const SNAPSHOT_EDGE = 1024;

/**
 * The model as it stands, ready to travel with a follow-up.
 *
 * Takes the studio's own snapshot rather than a file, and comes back marked 'current' so
 * the agent reads it as its own work rather than as a brief. Returns null instead of an
 * error: nobody asked for this picture, so failing to get one is not worth a word to
 * anybody — the turn simply goes without it, exactly as it used to.
 */
export async function prepareSnapshot(dataUrl: string): Promise<PreparedImage | null> {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = dataUrl;
  });
  if (!image?.naturalWidth) return null;

  const encoded = encode(image, SNAPSHOT_EDGE, 0.85);
  if (!encoded) return null;

  return {
    form: "image",
    data: encoded.slice(encoded.indexOf(",") + 1),
    mediaType: "image/jpeg",
    previewUrl: encoded,
    name: "On screen now",
    kind: "current",
  };
}

export async function prepareImage(file: File): Promise<PrepareResult> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, error: "That file isn't a picture I can read. Try a PNG, JPG or WEBP." };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { ok: false, error: "That picture is really big. Try a smaller one." };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    return { ok: false, error: "I couldn't open that picture. Try a different one." };
  }

  let previewUrl: string | null = null;
  for (const { edge, quality } of ATTEMPTS) {
    const encoded = encode(image, edge, quality);
    if (!encoded) return { ok: false, error: "I couldn't open that picture. Try a different one." };

    previewUrl = encoded;
    if (encoded.length - encoded.indexOf(",") - 1 <= TARGET_BASE64_BYTES) break;
  }

  if (!previewUrl) return { ok: false, error: "I couldn't open that picture. Try a different one." };

  return {
    ok: true,
    attachment: {
      form: "image",
      data: previewUrl.slice(previewUrl.indexOf(",") + 1),
      mediaType: "image/jpeg",
      previewUrl,
      name: file.name,
      kind: "reference",
    },
  };
}
