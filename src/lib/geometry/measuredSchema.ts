/**
 * The measured block, as the server is willing to receive it.
 *
 * Kept apart from `facts.ts` so that module stays free of zod: the studio imports it, and a
 * validator has no business in a browser bundle. Kept apart from either route because two
 * routes now take these numbers, and a second copy of the bounds is a second thing to get
 * wrong.
 *
 * Every field is a bounded number or a boolean. The English the model reads is written from
 * them by `describeMeasurements`, on this side — so no string the browser controls can reach
 * a prompt through here, and a field can't be used to say something the person didn't say.
 */
import { z } from "zod";
import type { Measured } from "./facts";

const point = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const MeasuredSchema = z.object({
  size: point,
  volume: z.number().nonnegative().finite(),
  area: z.number().nonnegative().finite(),
  centroid: point.nullable(),
  watertight: z.boolean(),
  openEdges: z.number().int().nonnegative().max(10_000_000),
  overhangArea: z.number().nonnegative().finite(),
  overhangFraction: z.number().min(0).max(1),
  steepestOverhangDeg: z.number().min(0).max(90),
  contactArea: z.number().nonnegative().finite(),
  tipMarginMm: z.number().finite().nullable(),
});

/** Fails the build if the schema and the shape it validates ever drift apart. */
const _sameShape: Measured = {} as z.infer<typeof MeasuredSchema>;
void _sameShape;
