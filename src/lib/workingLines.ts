/**
 * What Scaid says while it's thinking.
 *
 * Two rules these follow: every line describes work *happening*, never work nearly finished
 * — a design can take 30+ seconds and "almost there" turns into a lie roughly every time.
 * And they're picked at random rather than cycled, so a long wait doesn't reveal a loop.
 */
const WORKING_LINES = [
  "Sketching it out…",
  "Doing the math…",
  "Measuring twice…",
  "Thinking in three dimensions…",
  "Squaring up the corners…",
  "Wrangling polygons…",
  "Arguing with a cylinder…",
  "Talking the cube into it…",
  "Subtracting the parts that shouldn't be there…",
  "Rounding off the sharp bits…",
  "Nudging vertices around…",
  "Deciding how thick is thick enough…",
  "Consulting the blueprints…",
  "Checking the math on that curve…",
  "Stacking shapes…",
  "Carving out the details…",
  "Lining up the edges…",
  "Working out where the weight goes…",
  "Giving it somewhere flat to stand…",
  "Turning words into geometry…",
  "Second-guessing a measurement…",
  "Bending a few lines into shape…",
];

/** A line at random, never the one already on screen. */
export function nextWorkingLine(current?: string): string {
  const options = current ? WORKING_LINES.filter((line) => line !== current) : WORKING_LINES;
  return options[Math.floor(Math.random() * options.length)];
}
