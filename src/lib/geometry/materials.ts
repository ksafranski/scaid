/**
 * Turning a volume into the numbers a maker actually wants: weight, and filament used.
 *
 * With one enormous caveat that every caller has to carry with the number: a printed part
 * is not solid. These figures are for a part with no infill pattern and no hollow middle,
 * which is an upper bound, usually two to four times the real thing. A figure that gets
 * quoted as fact here would be wrong on every print anyone makes.
 *
 * Deliberately no infill percentage to scale it down by. Walls, top layers and bottom
 * layers dominate at low infill, so multiplying by the infill number would be further from
 * the truth than the honest ceiling is — and it would look precise while doing it.
 */

/** Grams per cubic centimeter. PLA is what almost everyone prints in. */
export const PLA_DENSITY_G_CM3 = 1.24;

/** Cross-section of 1.75mm filament, in square millimeters: pi * (1.75 / 2) ^ 2. */
const FILAMENT_AREA_MM2 = Math.PI * (1.75 / 2) ** 2;

export interface MaterialEstimate {
  /** Grams, if the part were printed solid. */
  grams: number;
  /** Millimeters of 1.75mm filament, if the part were printed solid. */
  filamentMm: number;
}

export function estimateMaterial(volumeMm3: number): MaterialEstimate {
  return {
    grams: (volumeMm3 * PLA_DENSITY_G_CM3) / 1000,
    filamentMm: volumeMm3 / FILAMENT_AREA_MM2,
  };
}
