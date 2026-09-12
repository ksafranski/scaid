import type { ObjectId } from "mongodb";
import type { Version } from "./versions";

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
  /** The maker's own write-up, in Markdown. Absent on anything saved before readmes. */
  readme?: string;
  /** Set once the name and description are the person's own words, not the agent's. */
  titled?: boolean;
  /**
   * The build as it was, each time it changed. Absent on anything saved before history.
   *
   * Kept on the record rather than beside it: a history that didn't come back when the
   * build was reopened would only cover the session that made it, which is the session
   * least likely to need it.
   */
  versions?: Version[];
  /**
   * Which worked techniques the build was made from.
   *
   * Stored rather than recomputed, which is the opposite of the rule for measurements —
   * and for the opposite reason. A measurement can always be taken again off the mesh, so
   * storing one only lets it go stale. Provenance cannot be taken again: the agent is told
   * to paste a pattern in and rename it to suit the object, so by the time the build is
   * saved nothing in the code says where it came from. Absent on anything saved before this.
   */
  patternIds?: string[];
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
  readme?: string;
  titled?: boolean;
  versions?: Version[];
  patternIds?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A saved readme with nothing built behind it yet — a plan written before the model.
 *
 * The code is what makes a record a build, so its absence is what makes one a draft; there
 * is no separate flag to keep in step with it.
 */
export function isDraft(creation: Pick<Creation, "code">): boolean {
  return !creation.code.trim();
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
    readme: doc.readme,
    titled: doc.titled,
    versions: doc.versions,
    patternIds: doc.patternIds,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
