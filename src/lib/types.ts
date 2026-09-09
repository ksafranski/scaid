import type { ObjectId } from "mongodb";

/** One plain-language step explaining a piece of the model. */
export interface BuildStep {
  /** A name from ICON_NAMES. Optional because creations saved before icons used `emoji`. */
  icon?: string;
  /** Legacy: free-text emoji from earlier saved creations. Rendered via the fallback icon. */
  emoji?: string;
  title: string;
  why: string;
}

/** Printer settings, remembered per account. */
export interface UserSettings {
  /** Build plate edge length in millimeters — the square the model has to fit inside. */
  plateSizeMm: number;
}

export const DEFAULT_SETTINGS: UserSettings = { plateSizeMm: 220 };

/** Common bed sizes, plus room to type your own. */
export const PLATE_PRESETS = [120, 180, 200, 220, 235, 250, 256, 300, 350, 400] as const;

export const MIN_PLATE_MM = 50;
export const MAX_PLATE_MM = 1000;

export function normalizePlateSize(value: unknown): number | null {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size) || size < MIN_PLATE_MM || size > MAX_PLATE_MM) return null;
  return size;
}

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  nickname: string;
  settings?: UserSettings;
  createdAt: Date;
}

export interface CreationDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  prompt: string;
  code: string;
  /** What the object is. Absent on builds saved before this was split out of `summary`. */
  description?: string;
  /** What changed on the turn this was saved. */
  summary: string;
  steps: BuildStep[];
  /** Set once the name and description are the person's own words, not the agent's. */
  titled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape sent to the browser — no ObjectIds, no other users' data. */
export interface Creation {
  id: string;
  name: string;
  prompt: string;
  code: string;
  description?: string;
  summary: string;
  steps: BuildStep[];
  titled?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What to show as a build's description, falling back for records saved before the split. */
export function describeCreation(creation: Pick<Creation, "description" | "summary">): string {
  return creation.description?.trim() || creation.summary;
}

export function toCreation(doc: CreationDoc): Creation {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    prompt: doc.prompt,
    code: doc.code,
    description: doc.description,
    summary: doc.summary,
    steps: doc.steps,
    titled: doc.titled,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
