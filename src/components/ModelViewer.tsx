"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowUpRight,
  ArrowUUpLeft,
  Cube,
  Lasso,
  Ruler,
  SquareHalf,
  Trash,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { WorkingLine, WorkingOverlay } from "./Working";
import { MARKUP_COLOR, REGION_FILL, renderMarkup, type Mark, type MarkPoint } from "@/lib/markup";
import {
  MEASURE_COLOR,
  coords,
  deg,
  mm,
  place,
  span,
  toSpot,
  type Measurement,
  type PlatePoint,
  type Spot,
} from "@/lib/measure";
import type { PreparedImage } from "@/lib/attachment";
import {
  defaultPosition,
  sectionRange,
  startingAxis,
  type Axis,
  type Section,
} from "@/lib/geometry/section";
import type { Bounds } from "@/lib/geometry/inspect";
import type { ModelViewerElement } from "@/types/model-viewer";

// The model sits Z-up like OpenSCAD; model-viewer is Y-up, so tip it a quarter turn.
const ORIENTATION = "0deg -90deg 0deg";
const HOME_ORBIT = "-40deg 70deg 320mm";
const HOME_TARGET = "0m 0.03m 0m";

/**
 * The key to hold for sliding the model around.
 *
 * model-viewer pans on Ctrl, Meta, Shift or a right-click drag, so both of these genuinely
 * work everywhere — this only picks the one that reads as native. Safe to call during
 * render: the viewer renders nothing but "Warming up…" until the custom element has loaded
 * in the browser, so the server never produces markup this could disagree with.
 */
function panModifier(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  // `platform` is deprecated but is still the most dependable Mac signal in every browser.
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

type Tool = "region" | "arrow" | "measure";

/**
 * The cut's colour: amber, deliberately unlike the teal of a measurement and the pink of a
 * mark, because all three can be on screen together.
 */
const SECTION_COLOR = "#f5a524";

const AXIS_LABELS: Array<{ axis: Axis; label: string; hint: string }> = [
  { axis: "x", label: "X", hint: "Cut across, left to right" },
  { axis: "y", label: "Y", hint: "Cut across, front to back" },
  { axis: "z", label: "Z", hint: "Cut level, like a floor" },
];

/** A fresh cut: straight down through the middle, which is what "cut it open" means. */
function startingSection(bounds: Bounds): Section {
  const axis = startingAxis(bounds);
  return { axis, position: defaultPosition(bounds, axis) };
}

/**
 * The slot name for one end of a measurement.
 *
 * A measurement is anchored to the model through a model-viewer hotspot, which is addressed
 * by slot name and must start with "hotspot". Ids are never reused, because a hotspot reads
 * its position once when its element appears and ignores the attribute afterwards.
 */
function slotFor(id: number, end: "from" | "to"): string {
  return `hotspot-measure-${id}-${end}`;
}

/**
 * The same point and direction, on the axes model-viewer hangs hotspots from.
 *
 * A hotspot is attached to the viewer's target node, which sits *above* the quarter turn
 * ORIENTATION applies, while a raycast hit comes back from below it — so the two frames
 * disagree by exactly that turn, and a hotspot placed straight from a hit lands somewhere
 * else on the model. Undoing the turn here is the difference between a measurement that
 * stays where it was taken and one that slides off the surface.
 */
function hotspotPosition(point: PlatePoint): string {
  return `${point.x / 1000}m ${point.z / 1000}m ${-point.y / 1000}m`;
}

function hotspotNormal(facing: PlatePoint): string {
  return `${facing.x} ${facing.z} ${-facing.y}`;
}

/**
 * How far the pointer has to wander from a fresh reading before its numbers step aside.
 *
 * Far enough that reading them isn't a race, short enough that they're gone by the time the
 * hand has moved on to the next measurement — and they don't come back, so what's on screen
 * is always either the reading just taken or the one being pointed at.
 */
const DISMISS_DISTANCE = 90;

/** Where one end of a measurement is on screen, and whether it's on the side we can see. */
interface Projection extends MarkPoint {
  facing: boolean;
}

/**
 * What a spec-document snapshot gets painted onto.
 *
 * The viewer is transparent so the studio's background shows through, but a transparent PNG
 * lands on the white page of a document with the grid and the shadows — both drawn for a
 * dark backdrop — sitting on nothing. Flattening onto the studio's own color keeps the
 * picture looking like the thing they were just looking at.
 */
const SNAPSHOT_BACKDROP = "#0b0e14"; // --color-ink-900, the preview panel's own background

/** Enough for a full-page picture in a document, without a megabyte of PNG. */
const SNAPSHOT_MAX_EDGE = 1600;

/** Room around the object in the picture, so it isn't jammed against the frame. */
const SNAPSHOT_MARGIN = 1.15;

/** The GLB is written at 1mm = 0.001 units — see `measure.ts`, which relies on the same. */
const MM_PER_METER = 1000;

/**
 * Trims the part of a snapshot where nothing was drawn.
 *
 * The viewport is whatever shape the panel has been dragged to, and the model sits
 * somewhere inside it with empty space above and around — on a tall narrow panel that's a
 * third of the picture, gone to sky. Carried into a document, that empty space is what decides
 * the picture's proportions, and a tall empty picture laid into a wide slot gets fitted by
 * its height: a narrow strip down the middle of the page with the model tiny inside it.
 *
 * The viewer draws on transparency, so where nothing was drawn is exactly where the alpha
 * is zero. Cropping to the rest gives a picture shaped like its contents.
 */
function contentBounds(
  source: HTMLImageElement,
): { x: number; y: number; width: number; height: number } | null {
  const scan = document.createElement("canvas");
  scan.width = source.naturalWidth;
  scan.height = source.naturalHeight;

  const context = scan.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0);

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, scan.width, scan.height).data;
  } catch {
    return null; // tainted canvas; the whole picture is still a picture
  }

  let minX = scan.width;
  let minY = scan.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < scan.height; y++) {
    for (let x = 0; x < scan.width; x++) {
      // Anything but fully clear counts: the plate's grid lines and the model's own
      // shadow are faint, and they're part of the picture.
      if (pixels[(y * scan.width + x) * 4 + 3] > 4) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null; // nothing drawn at all
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Points the camera at the object, and hands back the undo.
 *
 * Keeps the angle and moves only the distance and what's being looked at, so the picture
 * is of the thing they posed rather than of a different pose. The distance is worked out
 * rather than guessed: a sphere around the object, dropped back far enough that it subtends
 * the narrower of the two half-angles the viewport has — the vertical one on a wide panel,
 * the horizontal one on a tall one, which is the one that would otherwise clip it.
 *
 * Returns a no-op when there's nothing measured to frame against, which leaves the view
 * exactly as it is: a picture framed by hand beats one framed by a guess.
 */
function frameOnModel(viewer: ModelViewerElement, bounds: Bounds | null): () => void {
  if (!bounds) return () => {};

  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  const radius = Math.hypot(size.x, size.y, size.z) / 2 / MM_PER_METER;
  if (!(radius > 0)) return () => {};

  const orbit = viewer.getCameraOrbit();
  const target = viewer.getCameraTarget();
  const view = viewer.getBoundingClientRect();
  if (!view.width || !view.height) return () => {};

  const halfVertical = ((viewer.getFieldOfView() * Math.PI) / 180) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * (view.width / view.height));
  const distance = (radius / Math.sin(Math.min(halfVertical, halfHorizontal))) * SNAPSHOT_MARGIN;

  // The middle of the object, on the axes model-viewer hangs things from — the same turn
  // the hotspots undo, for the same reason.
  const middle = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };

  viewer.cameraTarget = `${middle.x / MM_PER_METER}m ${middle.z / MM_PER_METER}m ${-middle.y / MM_PER_METER}m`;
  viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${distance}m`;
  viewer.jumpCameraToGoal();

  return () => {
    viewer.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
    viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
    viewer.jumpCameraToGoal();
  };
}

/** Draws the viewer's transparent snapshot onto the studio's background. */
async function flatten(snapshot: string): Promise<string | null> {
  const source = await new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = snapshot;
  });
  if (!source?.naturalWidth) return null;

  const crop =
    contentBounds(source) ??
    { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight };

  const fit = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width * fit);
  canvas.height = Math.round(crop.height * fit);

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = SNAPSHOT_BACKDROP;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png");
}

/** What the composer collects as it sends. */
export interface Markup {
  image: PreparedImage;
}

export function ModelViewer({
  src,
  spinning,
  captureRef,
  snapshotRef,
  section,
  modelBounds,
  onSection,
}: {
  src: string | null;
  spinning: boolean;
  /** The cut currently being looked through, or null for the whole model. */
  section?: Section | null;
  /**
   * The whole model's extents, in plate millimeters.
   *
   * Bounds where a cut can be placed, and frames the picture the write-up takes.
   */
  modelBounds?: Bounds | null;
  onSection?: (section: Section | null) => void;
  /**
   * Filled in with a function the composer calls as it sends.
   *
   * Marks aren't an attachment you add and then look at — they sit on the model where you
   * drew them, and they're collected at the moment the message goes.
   */
  captureRef?: React.MutableRefObject<(() => Promise<Markup | null>) | null>;
  /**
   * Filled in with a function that returns the view as a PNG data URL, for the spec
   * document. Null while there's nothing on screen worth picturing.
   */
  snapshotRef?: React.MutableRefObject<(() => Promise<string | null>) | null>;
}) {
  const viewerRef = useRef<ModelViewerElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [drawing, setDrawing] = useState<Mark | null>(null);
  /**
   * The mark being drawn, held in a ref as well as in state.
   *
   * State drives what you see; the ref is what the handlers read. Pointer events can arrive
   * faster than React re-renders, and a handler reading the state variable would then be
   * looking at a stale value — reliably so when a whole gesture lands in one task.
   */
  const drawingRef = useRef<Mark | null>(null);

  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  /** The measurement being dragged out: where it started on the model, and on the screen. */
  const [measuring, setMeasuring] = useState<{
    from: Spot;
    at: MarkPoint;
    to: MarkPoint;
    /** The last spot under the cursor that was on the model, so a reading always has an end. */
    landing: Spot;
    /** Which model it was taken from, so a build that lands mid-drag doesn't finish it. */
    model: string | null;
  } | null>(null);
  const measuringRef = useRef<typeof measuring>(null);
  const nextMeasurementRef = useRef(1);
  /**
   * Which kind of thing was added when, newest last, so one Undo button can serve both.
   *
   * Marks and measurements are kept apart — one is a drawing on the screen, the other a
   * reading off the model — but they're made with the same hand, and undo has to walk back
   * through them in the order they happened.
   */
  const [order, setOrder] = useState<Array<"mark" | "measure">>([]);

  /**
   * Where each measurement's ends currently sit on screen, by hotspot slot name.
   *
   * The ends themselves are model coordinates; model-viewer projects them for us through the
   * hotspots, and this is the projection as of the last frame.
   */
  const [projected, setProjected] = useState<Record<string, Projection>>({});

  /**
   * Which measurement has its numbers open, and why.
   *
   * `opened` is the one just taken — its details come up on the spot, where you were already
   * looking, and stay until you do something else. `hovered` is the one under the pointer,
   * which wins while it lasts, so an older reading can be read back without disturbing
   * anything.
   */
  const [opened, setOpened] = useState<{ id: number; from: MarkPoint } | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  /** The overlay's own size, so a popup near an edge can be kept inside it. */
  const [viewBox, setViewBox] = useState({ width: 0, height: 0 });

  // Only the screen-space tools have to hold the camera still — a measurement is pinned to
  // the model, so it survives being spun around and there's every reason to let them.
  const marking = tool !== null || marks.length > 0;

  const [ready, setReady] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  // The custom element registers itself on import, and only works in the browser.
  useEffect(() => {
    let cancelled = false;
    import("@google/model-viewer").then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Measurements belong to the shape they were taken from.
   *
   * A new build moves the surfaces out from under them, so keeping them would leave numbers
   * on screen describing an object nobody can see any more. Done here on the way into the
   * render rather than in an effect — this is the model changing under the state, not the
   * state being synchronised with anything outside React — and the viewer's own "load" event
   * is no good for it: the viewer fires that again whenever a hotspot joins the scene, which
   * is to say every time a measurement is taken.
   */
  const [measuredModel, setMeasuredModel] = useState(src);
  if (measuredModel !== src) {
    setMeasuredModel(src);
    setMeasurements([]);
    setOrder((prev) => prev.filter((kind) => kind !== "measure"));
    setMeasuring(null);
  }

  // model-viewer needs a moment to decode the GLB after we hand it the URL. Without
  // tracking its "load" event the viewer sits blank in between, which reads as a failure.
  // Derived rather than stored, so switching src automatically falls back to "loading"
  // without an extra render pass.
  const modelShown = Boolean(src) && loadedSrc === src;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !src) return;

    const onLoad = () => setLoadedSrc(src);

    // The model can finish loading before this listener attaches — on a re-mount, or when
    // the blob is already decoded. Subscribing alone would then wait for an event that has
    // already fired and leave the "Almost ready" overlay up for good, so read the current
    // state too.
    if (viewer.loaded) onLoad();

    viewer.addEventListener("load", onLoad);
    return () => viewer.removeEventListener("load", onLoad);
  }, [src, ready]);

  function pointIn(event: React.PointerEvent<HTMLDivElement>): MarkPoint {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /**
   * Switches tools, clearing the readings on the way out of the ruler.
   *
   * Measurements last exactly as long as the ruler is in hand: putting it down is how you
   * clear them off the model, and picking it up again starts a fresh set rather than handing
   * back the last lot. That keeps one invariant the rest of this component leans on — there
   * are never measurements while some other tool, or no tool, is selected — so nothing else
   * has to ask whether they ought to be on screen.
   */
  function chooseTool(next: Tool | null) {
    if (tool === "measure" && next !== "measure") {
      setMeasurements([]);
      setOrder((prev) => prev.filter((kind) => kind !== "measure"));
      measuringRef.current = null;
      setMeasuring(null);
      setOpened(null);
      setHovered(null);
    }
    setTool(next);
  }

  /**
   * Opens, moves or closes the cut.
   *
   * The ruler is left alone on purpose — cutting the model open and then measuring the wall
   * you've exposed is the entire reason this exists. The marking tools are not: a loop
   * drawn on a sliced model travels to the agent as a picture of the model "as it looks
   * right now", and what it looks like right now is an object with a wedge out of it.
   */
  function chooseSection(next: Section | null) {
    if (next && (tool === "region" || tool === "arrow")) chooseTool(null);
    onSection?.(next);
  }

  function addMark(mark: Mark) {
    setMarks((prev) => [...prev, mark]);
    setOrder((prev) => [...prev, "mark"]);
  }

  function addMeasurement(from: Spot, to: Spot | null, at: MarkPoint) {
    const id = nextMeasurementRef.current++;
    setMeasurements((prev) => [...prev, { id, from, to }]);
    setOrder((prev) => [...prev, "measure"]);
    // `at` is where the pointer let go: the numbers stay up until it wanders off from there.
    setOpened({ id, from: at });
  }

  /** Takes one measurement off the model, from its own label. */
  function removeMeasurement(id: number) {
    setMeasurements((prev) => prev.filter((measurement) => measurement.id !== id));
    setOpened((prev) => (prev?.id === id ? null : prev));
    setHovered((prev) => (prev === id ? null : prev));
    setOrder((prev) => {
      const at = prev.lastIndexOf("measure");
      return at === -1 ? prev : [...prev.slice(0, at), ...prev.slice(at + 1)];
    });
  }

  /** Walks back through the marks and measurements, newest first. */
  function undo() {
    const last = order[order.length - 1];
    if (!last) return;

    setOrder((prev) => {
      const at = prev.lastIndexOf(last);
      return at === -1 ? prev : [...prev.slice(0, at), ...prev.slice(at + 1)];
    });
    if (last === "mark") setMarks((prev) => prev.slice(0, -1));
    else setMeasurements((prev) => prev.slice(0, -1));
  }

  /** Wipes the drawn-on marks. Puts the ruler down too, which clears its readings. */
  function clearMarks() {
    setMarks([]);
    setOrder((prev) => prev.filter((kind) => kind !== "mark"));
    drawingRef.current = null;
    setDrawing(null);
    chooseTool(null);
  }

  function clearAll() {
    setMarks([]);
    setMeasurements([]);
    setOrder([]);
    drawingRef.current = null;
    setDrawing(null);
    measuringRef.current = null;
    setMeasuring(null);
    setTool(null);
  }

  /**
   * Where a pixel lands on the model, as a reading off the plate.
   *
   * Client coordinates, not element ones: model-viewer's own raycast subtracts the element's
   * box itself, whatever its documentation says about the arguments.
   */
  function plateAt(event: React.PointerEvent<HTMLDivElement>): Spot | null {
    const hit = viewerRef.current?.positionAndNormalFromPoint(event.clientX, event.clientY);
    return hit ? toSpot(hit) : null;
  }

  /** Keeps the overlay's size to hand, so a popup near an edge can be nudged back inside. */
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const watch = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    watch.observe(surface);
    return () => watch.disconnect();
  }, [modelShown]);

  /**
   * Follows the measurement ends around the screen as the model turns.
   *
   * Polled on every frame rather than driven by "camera-change": the ends also move when the
   * panel is resized or the model finishes loading, and a frame's worth of lag in the line
   * is visible where a missed event is not. The state only changes when the numbers do, so a
   * still model costs two projections a frame and no renders.
   */
  useEffect(() => {
    // Nothing to follow, and nothing to tidy: each pass rebuilds the map from scratch, and
    // the entries of a measurement that has been undone are keyed by an id nothing will ask
    // for again.
    if (!measurements.length) return;

    let frame = 0;
    let last = "";

    const follow = () => {
      frame = requestAnimationFrame(follow);
      const viewer = viewerRef.current;
      if (!viewer) return;

      const next: Record<string, Projection> = {};
      for (const measurement of measurements) {
        for (const end of ["from", "to"] as const) {
          if (end === "to" && !measurement.to) continue;
          const name = slotFor(measurement.id, end);
          const spot = viewer.queryHotspot(name);
          if (spot) {
            next[name] = {
              x: spot.canvasPosition.x,
              y: spot.canvasPosition.y,
              facing: spot.facingCamera,
            };
          }
        }
      }

      const signature = JSON.stringify(next);
      if (signature === last) return;
      last = signature;
      setProjected(next);
    };

    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [measurements]);

  /**
   * Hands the composer the marked-up view, then wipes the slate.
   *
   * Cleared on the way out because the marks describe the model as it looks right now — the
   * moment the answer arrives and the shape changes, they'd be pointing at the wrong thing.
   */
  useEffect(() => {
    if (!captureRef) return;

    captureRef.current = async () => {
      const viewer = viewerRef.current;
      const surface = surfaceRef.current;
      if (!viewer || !surface || marks.length === 0) return null;

      const box = surface.getBoundingClientRect();
      const image = await renderMarkup(
        viewer.toDataURL("image/jpeg", 0.92),
        marks,
        box.width,
        box.height,
      );
      if (!image) return null;

      clearMarks();
      return { image };
    };

    return () => {
      captureRef.current = null;
    };
  });

  /**
   * The view as it stands, as a picture.
   *
   * Whatever they've spun the model to is the shot — a spec is written about the angle the
   * person chose to look at it from, not about a canonical pose they never saw.
   */
  useEffect(() => {
    if (!snapshotRef) return;

    snapshotRef.current = async () => {
      const viewer = viewerRef.current;
      if (!viewer || !modelShown) return null;

      // Frame the object before taking the picture, then put the view back.
      //
      // The viewport is set up for working in: the plate runs off every edge and the model
      // sits somewhere in the middle of it. That's right for building and wrong for a
      // picture, where the plate is context and the object is the subject — and a build
      // plate is 220mm against an object that's often a tenth of that, so the subject
      // arrives as a speck on a grid.
      //
      // Only the distance and the centre move. The angle is left exactly as they turned
      // it, because which way the thing is facing is the part they chose.
      const restore = frameOnModel(viewer, modelBounds ?? null);
      try {
        // Two frames: one for the camera to take the new goal, one to draw at it.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return await flatten(viewer.toDataURL("image/png"));
      } finally {
        restore();
      }
    };

    return () => {
      snapshotRef.current = null;
    };
  }, [snapshotRef, modelShown, modelBounds]);

  const resetView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.cameraOrbit = HOME_ORBIT;
    viewer.cameraTarget = HOME_TARGET;
    viewer.jumpCameraToGoal();
  }, []);

  // Far enough that it reads as a drag rather than a click, and so the live reading doesn't
  // flash up over a two-pixel line.
  const dragging =
    measuring !== null &&
    Math.hypot(measuring.to.x - measuring.at.x, measuring.to.y - measuring.at.y) > 6;
  const liveSpan =
    measuring && dragging ? span({ id: 0, from: measuring.from, to: measuring.landing }) : null;


  /**
   * Every number on the overlay, laid out together.
   *
   * The one being dragged goes first so it keeps the spot under the cursor and the settled
   * ones move around it — while a measurement is being taken, it's the one being read.
   */
  const tags = layOutTags([
    ...(measuring && liveSpan
      ? [
          {
            key: "live",
            at: tagSpot(measuring.at, measuring.to),
            text: `${mm(liveSpan.distance)} mm`,
          },
        ]
      : []),
    ...measurements.flatMap((measurement) => {
      const a = projected[slotFor(measurement.id, "from")];
      const b = measurement.to ? projected[slotFor(measurement.id, "to")] : null;
      if (!a) return [];

      const reading = span(measurement);
      return [
        {
          key: String(measurement.id),
          at: b ? tagSpot(a, b) : { x: a.x, y: a.y - 20 },
          text: reading ? `${mm(reading.distance)} mm` : coords(measurement.from.at),
          dimmed: !a.facing && !(b?.facing ?? false),
          onRemove: () => removeMeasurement(measurement.id),
          onHover: (over: boolean) => {
            setHovered(over ? measurement.id : null);
            // Pointing at a label is the end of the fresh one's turn: without this, moving
            // off this label would fall back to whatever was drawn last, and a popup nobody
            // asked for would reappear somewhere else on the model.
            if (over) setOpened(null);
          },
        },
      ];
    }),
  ]);

  /**
   * The reading whose numbers are open, anchored to its own label.
   *
   * Hovering wins over the one just taken, and a measurement with no label on screen yet —
   * an end that hasn't projected — has nowhere to hang a popup, so it simply doesn't get one.
   */
  const detailed = (() => {
    const id = hovered ?? opened?.id ?? null;
    if (id === null || measuring) return null;
    const measurement = measurements.find((one) => one.id === id);
    const tag = tags.find((one) => one.key === String(id));
    return measurement && tag ? { measurement, at: tag.at } : null;
  })();

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <WorkingLine label="Warming up…" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <model-viewer
        ref={viewerRef}
        src={src ?? ""}
        alt="Your 3D creation. Drag to spin it around."
        {...(marking ? {} : { "camera-controls": true })}
        orientation={ORIENTATION}
        camera-orbit={HOME_ORBIT}
        camera-target={HOME_TARGET}
        min-camera-orbit="auto auto 40mm"
        max-camera-orbit="auto auto 1200mm"
        // "neutral" is built to show colour truthfully and lights from everywhere at once
        // to do it, which leaves a pale object with no shading to read. "legacy" comes from
        // fewer directions, so faces at different angles come back at different values.
        environment-image="legacy"
        shadow-intensity="1.2"
        shadow-softness="0.6"
        // A shoulder on the highlights rather than a clip. A light grey object under the
        // old setting ran out of headroom and went flat white wherever it faced the light,
        // taking the shading with it.
        tone-mapping="aces"
        exposure="1.05"
        interaction-prompt="none"
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "transparent",
          visibility: src ? "visible" : "hidden",
        }}
      >
        {/*
          The anchors that hold measurements onto the model. model-viewer turns a child in a
          "hotspot-" slot into a point in the model's own space and keeps track of where that
          lands on screen; these stay empty because the line and the numbers are drawn in the
          overlay above, where they can be styled like everything else here.
        */}
        {measurements.flatMap((measurement) =>
          (["from", "to"] as const).flatMap((end) => {
            const spot = measurement[end];
            if (!spot) return [];
            return [
              <div
                key={slotFor(measurement.id, end)}
                slot={slotFor(measurement.id, end)}
                data-position={hotspotPosition(spot.at)}
                data-normal={hotspotNormal(spot.facing)}
                aria-hidden
                style={{ width: 0, height: 0, pointerEvents: "none" }}
              />,
            ];
          }),
        )}
      </model-viewer>

      {src && modelShown && (
        <div
          ref={surfaceRef}
          onPointerDown={(event) => {
            // Anywhere else on the model puts the open reading away — this fires for a press
            // on bare model or background, but not for one on a label, which sits above.
            setOpened(null);

            if (!tool) return;
            const at = pointIn(event);

            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // The line just won't follow the cursor outside the box; not worth losing it.
            }

            if (tool === "measure") {
              // A miss is a click on the background, and there's nothing there to measure.
              const on = plateAt(event);
              if (!on) return;
              const started = { from: on, at, to: at, landing: on, model: src };
              measuringRef.current = started;
              setMeasuring(started);
              return;
            }

            const started: Mark =
              tool === "region" ? { kind: "region", points: [at] } : { kind: "arrow", from: at, to: at };
            drawingRef.current = started;
            setDrawing(started);
          }}
          onPointerMove={(event) => {
            // A fresh reading is put away by the pointer leaving it behind, wherever the
            // gesture goes next — a drag for the next measurement included.
            if (opened) {
              const at = pointIn(event);
              const gone = Math.hypot(at.x - opened.from.x, at.y - opened.from.y);
              if (gone > DISMISS_DISTANCE) setOpened(null);
            }

            const measurement = measuringRef.current;
            if (measurement) {
              // Re-cast as it moves so the reading counts up under the cursor, the way a
              // tape measure does. `landing` holds the last spot that was actually on the
              // model, so sliding off the edge freezes the number instead of losing it.
              const next = {
                ...measurement,
                to: pointIn(event),
                landing: plateAt(event) ?? measurement.landing,
              };
              measuringRef.current = next;
              setMeasuring(next);
              return;
            }

            const current = drawingRef.current;
            if (!current) return;
            const at = pointIn(event);

            let next: Mark;
            if (current.kind === "arrow") {
              next = { ...current, to: at };
            } else if (current.kind === "region") {
              // Thin the trail: a point per pixel is noise in the polygon and in the line.
              const last = current.points[current.points.length - 1];
              if (last && Math.hypot(at.x - last.x, at.y - last.y) < 4) return;
              next = { ...current, points: [...current.points, at] };
            } else {
              return;
            }

            drawingRef.current = next;
            setDrawing(next);
          }}
          onPointerUp={(event) => {
            const measurement = measuringRef.current;
            if (measurement) {
              measuringRef.current = null;
              setMeasuring(null);
              // A build landed while the pointer was down: this reading is of the old shape.
              if (measurement.model !== src) return;

              // A click that went nowhere asks where this spot is; a drag asks how far it is
              // to the other end. The same gesture answers both, so neither needs its own
              // button in a toolbar that sits on top of the model.
              const dragged = Math.hypot(
                measurement.to.x - measurement.at.x,
                measurement.to.y - measurement.at.y,
              );
              if (dragged <= 6) {
                addMeasurement(measurement.from, null, measurement.at);
                return;
              }

              const landed = plateAt(event) ?? measurement.landing;
              // Dragged straight off the model and never over it: nothing to measure to.
              if (landed !== measurement.from) {
                addMeasurement(measurement.from, landed, measurement.to);
              }
              return;
            }

            // From the ref, never from inside a setDrawing updater: updaters have to be pure
            // and development runs them twice to prove it, which committed every mark twice.
            const current = drawingRef.current;
            drawingRef.current = null;
            setDrawing(null);
            if (!current) return;

            // Below these it was a stray click, not a mark.
            if (current.kind === "region" && current.points.length >= 3) addMark(current);
            if (
              current.kind === "arrow" &&
              Math.hypot(current.to.x - current.from.x, current.to.y - current.from.y) > 12
            ) {
              addMark(current);
            }
          }}
          onPointerLeave={() => setOpened(null)}
          onPointerCancel={() => {
            drawingRef.current = null;
            setDrawing(null);
            measuringRef.current = null;
            setMeasuring(null);
          }}
          // select-none: a drag across the viewer would otherwise sweep up the text of any
          // label or popup it passed over, and leave it highlighted.
          className={`absolute inset-0 z-20 select-none ${tool ? "cursor-crosshair" : "pointer-events-none"}`}
        >
          <svg className="pointer-events-none h-full w-full" aria-hidden>
            <defs>
              <marker id="markup-head" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill={MARKUP_COLOR} />
              </marker>
            </defs>

            {[...marks, ...(drawing ? [drawing] : [])].map((mark, index) =>
              mark.kind === "region" ? (
                <polyline
                  key={index}
                  points={mark.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill={REGION_FILL}
                  stroke={MARKUP_COLOR}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : mark.kind === "arrow" ? (
                <line
                  key={index}
                  x1={mark.from.x}
                  y1={mark.from.y}
                  x2={mark.to.x}
                  y2={mark.to.y}
                  stroke={MARKUP_COLOR}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  markerEnd="url(#markup-head)"
                />
              ) : null,
            )}

            {measurements.map((measurement) => {
              const a = projected[slotFor(measurement.id, "from")];
              const b = measurement.to ? projected[slotFor(measurement.id, "to")] : null;
              if (!a) return null;
              return <MeasureLine key={measurement.id} a={a} b={b} />;
            })}

            {measuring && (
              <MeasureLine
                a={{ ...measuring.at, facing: true }}
                b={{ ...measuring.to, facing: true }}
                live
              />
            )}
          </svg>

          {/*
            The numbers sit in HTML rather than in the SVG: a pill with a border and a
            backdrop is a few attributes here and a pile of them there, and they have to stay
            readable over whatever colour the model happens to be underneath.
          */}
          {tags.map((tag) => (
            <MeasureTag
              key={tag.key}
              at={tag.at}
              text={tag.text}
              dimmed={tag.dimmed}
              onRemove={tag.onRemove}
              onHover={tag.onHover}
            />
          ))}

          {detailed && (
            <Readout measurement={detailed.measurement} at={detailed.at} within={viewBox} />
          )}
        </div>
      )}

      {src && modelShown && captureRef && (
        <div className="absolute top-5 right-5 z-30 flex items-center gap-1.5 rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-lg shadow-black/40">
          <ToolButton
            active={tool === "region"}
            disabled={Boolean(section)}
            onClick={() => chooseTool(tool === "region" ? null : "region")}
            Glyph={Lasso}
            label={section ? "Close the cut to circle a part" : "Circle a part"}
          />
          <ToolButton
            active={tool === "arrow"}
            disabled={Boolean(section)}
            onClick={() => chooseTool(tool === "arrow" ? null : "arrow")}
            Glyph={ArrowUpRight}
            label={section ? "Close the cut to point at something" : "Point at something"}
          />
          <ToolButton
            active={tool === "measure"}
            tone={MEASURE_COLOR}
            onClick={() => chooseTool(tool === "measure" ? null : "measure")}
            Glyph={Ruler}
            label="Measure it"
          />
          {onSection && modelBounds && (
            <ToolButton
              active={Boolean(section)}
              tone={SECTION_COLOR}
              onClick={() =>
                chooseSection(section ? null : startingSection(modelBounds))
              }
              Glyph={SquareHalf}
              label="Cut it open"
            />
          )}

          {order.length > 0 && (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-px bg-ink-700" />
              <ToolButton onClick={undo} Glyph={ArrowUUpLeft} label="Undo the last one" />
              <ToolButton onClick={clearAll} Glyph={Trash} label="Clear marks and measurements" />
            </>
          )}
        </div>
      )}

      {src && modelShown && section && modelBounds && onSection && (
        <SectionControls
          key={section.axis}
          section={section}
          bounds={modelBounds}
          onChange={chooseSection}
        />
      )}

      {src && modelShown && marking && (
        <p
          className={`pointer-events-none absolute right-5 z-20 max-w-[15rem] rounded-lg bg-ink-850/95 px-3 py-1.5 text-right text-xs font-medium text-mist-300 ${
            section ? "top-44" : "top-20"
          }`}
        >
          {tool === "measure"
            ? "Click a spot for its position, or drag from one spot to another"
            : marks.length > 0
              ? `${marks.length} mark${marks.length === 1 ? "" : "s"} — sent with your next message`
              : tool === "region"
                ? "Draw a loop around a part"
                : "Drag to point at something"}
        </p>
      )}

      {src && modelShown && (
        <button
          onClick={resetView}
          className="absolute right-5 bottom-5 flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850/90 px-3.5 py-2 text-xs font-semibold text-mist-300 backdrop-blur transition hover:border-ink-600 hover:text-mist-100"
        >
          <ArrowCounterClockwise size={14} weight="bold" />
          Reset view
        </button>
      )}

      {src && modelShown && (
        <div className="pointer-events-none absolute bottom-5 left-5 max-w-[calc(100%-10rem)] text-xs font-medium text-mist-500">
          Drag to spin · scroll to zoom · {panModifier()} + drag to move
        </div>
      )}

      {src && !modelShown && (
        <WorkingOverlay label="Almost ready…" />
      )}

      {!src && !spinning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center">
          <div className="flex flex-col items-center">
            <Cube size={56} weight="duotone" className="text-ink-600" />
            <p className="font-display mt-5 text-lg font-semibold text-mist-500">Nothing built yet</p>
            <p className="mt-1 text-sm text-ink-500">Describe something on the left to get started.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** A number waiting to be placed on screen, and where it would rather sit. */
interface Tag {
  key: string;
  at: MarkPoint;
  text: string;
  dimmed?: boolean;
  onRemove?: () => void;
  onHover?: (over: boolean) => void;
}

/**
 * Roughly how wide a tag is, from its text: 11px tabular digits, its padding and border, and
 * the little × on the end. Estimated rather than measured, because the layout has to settle
 * before the thing is on screen to be measured.
 */
function tagHalfWidth(tag: Tag): number {
  return 8 + tag.text.length * 3.4 + (tag.onRemove ? 8 : 0);
}

const TAG_HALF_HEIGHT = 10;

/**
 * Nudges the numbers apart until each one can be read.
 *
 * Two measurements that cross put their labels in the same place, and two pills on the same
 * pixels read as one mangled one — the thing that made the overlay look broken rather than
 * busy. Earlier tags hold their ground and later ones step up out of the way, so the label
 * you just took moves rather than the ones you were reading.
 */
function layOutTags(tags: Tag[]): Tag[] {
  const taken: Array<{ x: number; y: number; halfWidth: number }> = [];

  return tags.map((tag) => {
    const halfWidth = tagHalfWidth(tag);
    const x = tag.at.x;
    let y = tag.at.y;

    // Bounded, because a dozen measurements stacked in one spot should end up crowded rather
    // than marching off the top of the viewer.
    for (let step = 0; step < 10; step++) {
      const clash = taken.some(
        (other) =>
          Math.abs(other.x - x) < other.halfWidth + halfWidth &&
          Math.abs(other.y - y) < TAG_HALF_HEIGHT * 2 + 2,
      );
      if (!clash) break;
      y -= TAG_HALF_HEIGHT * 2 + 4;
    }

    taken.push({ x, y, halfWidth });
    return { ...tag, at: { x, y } };
  });
}

/**
 * Where a span's number goes: clear of its own line, on the upper side of it.
 *
 * Sitting on the midpoint put the pill straight through the line it belonged to, which is
 * what turned two crossing measurements into a tangle of boxes and stripes.
 */
function tagSpot(a: MarkPoint, b: MarkPoint): MarkPoint {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  let across = { x: -Math.sin(angle), y: Math.cos(angle) };
  if (across.y > 0) across = { x: -across.x, y: -across.y };

  return {
    x: (a.x + b.x) / 2 + across.x * 18,
    y: (a.y + b.y) / 2 + across.y * 18,
  };
}

/**
 * A measurement drawn over the model: a span between two ends, or a single marked spot.
 *
 * Ends that face away from the camera are faded rather than hidden — the reading is still
 * true, it was just taken round the back, and a line that vanished mid-turn would look like
 * a bug.
 */
function MeasureLine({ a, b, live }: { a: Projection; b?: Projection | null; live?: boolean }) {
  const dimmed = !a.facing && !(b?.facing ?? false);
  const tick = 7;

  if (!b) {
    return (
      <g opacity={dimmed ? 0.4 : 1}>
        <circle cx={a.x} cy={a.y} r={4} fill={MEASURE_COLOR} stroke="#0b0e14" strokeWidth={1.5} />
        <line x1={a.x - tick - 3} y1={a.y} x2={a.x - 5} y2={a.y} stroke={MEASURE_COLOR} strokeWidth={1.5} />
        <line x1={a.x + 5} y1={a.y} x2={a.x + tick + 3} y2={a.y} stroke={MEASURE_COLOR} strokeWidth={1.5} />
        <line x1={a.x} y1={a.y - tick - 3} x2={a.x} y2={a.y - 5} stroke={MEASURE_COLOR} strokeWidth={1.5} />
        <line x1={a.x} y1={a.y + 5} x2={a.x} y2={a.y + tick + 3} stroke={MEASURE_COLOR} strokeWidth={1.5} />
      </g>
    );
  }

  // The end caps sit square across the line, the way the jaws of a caliper do, so it reads
  // as a span between two points rather than as another arrow.
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const across = { x: -Math.sin(angle) * tick, y: Math.cos(angle) * tick };

  return (
    <g opacity={dimmed ? 0.4 : 1}>
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={MEASURE_COLOR}
        strokeWidth={1.75}
        strokeDasharray={live ? "5 4" : undefined}
      />
      {[a, b].map((end, index) => (
        <line
          key={index}
          x1={end.x - across.x}
          y1={end.y - across.y}
          x2={end.x + across.x}
          y2={end.y + across.y}
          stroke={MEASURE_COLOR}
          strokeWidth={1.75}
        />
      ))}
      <circle cx={a.x} cy={a.y} r={3} fill={MEASURE_COLOR} stroke="#0b0e14" strokeWidth={1.25} />
      <circle cx={b.x} cy={b.y} r={3} fill={MEASURE_COLOR} stroke="#0b0e14" strokeWidth={1.25} />
    </g>
  );
}

/**
 * The number that goes with a measurement, parked beside it.
 *
 * This one pill takes the pointer where the rest of the overlay lets it through: hovering it
 * brings up the full reading, and the × on the end throws the measurement away. The cost is
 * that a drag can't begin on top of a label, which is a fair trade for a target this small.
 */
function MeasureTag({
  at,
  text,
  dimmed,
  onRemove,
  onHover,
}: {
  at: MarkPoint;
  text: string;
  dimmed?: boolean;
  onRemove?: () => void;
  onHover?: (over: boolean) => void;
}) {
  return (
    <span
      style={{ left: at.x, top: at.y, borderColor: MEASURE_COLOR, color: MEASURE_COLOR }}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-md border bg-ink-950/85 py-0.5 pr-1 pl-1.5 text-[11px] font-semibold tabular-nums whitespace-nowrap backdrop-blur ${
        onHover ? "pointer-events-auto" : "pointer-events-none"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      {text}
      {onRemove && (
        <button
          // The overlay underneath starts a new measurement on pointerdown, and a press on
          // this button is over the overlay — without stopping it here, throwing one reading
          // away would take another in the same gesture.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRemove}
          title="Remove this measurement"
          aria-label={`Remove the ${text} measurement`}
          className="rounded p-0.5 opacity-55 transition hover:opacity-100"
        >
          <X size={11} weight="bold" />
        </button>
      )}
    </span>
  );
}

const READOUT_WIDTH = 232;

/**
 * The numbers behind one measurement, floating over the label they belong to.
 *
 * Above the label where there's room and below it where there isn't, held inside the
 * viewer's edges either way — a panel that runs off the side of the picture is a panel you
 * can't read. It never takes the pointer: it appears over the model you're working on, and
 * an invisible wall sitting where you want to measure next would be worse than useless.
 *
 * Everything is stated against the plate rather than against the model's own bounding box:
 * the plate is the thing both the studio and the printer agree on, and "8mm up, 12mm out
 * from the middle" is a sentence you can check with calipers.
 */
function Readout({
  measurement,
  at,
  within,
}: {
  measurement: Measurement;
  at: MarkPoint;
  within: { width: number; height: number };
}) {
  const reading = span(measurement);

  // Estimated rather than measured: it only decides which side of the label to open on, and
  // a frame of the panel jumping after it had been placed would be worse than being 10px out.
  const height = reading ? 200 : 150;
  const gap = 14;
  const above = at.y - gap - height > 8 || at.y + gap + height > within.height - 8;

  const left = within.width
    ? Math.min(Math.max(at.x, READOUT_WIDTH / 2 + 8), within.width - READOUT_WIDTH / 2 - 8)
    : at.x;

  return (
    <div
      style={{
        left,
        top: above ? at.y - gap : at.y + gap,
        width: READOUT_WIDTH,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
      }}
      className="pointer-events-none absolute rounded-xl border border-ink-700 bg-ink-850/95 p-3 text-left shadow-lg shadow-black/40 backdrop-blur"
    >
      <p className="text-[10px] font-semibold tracking-[0.08em] text-mist-500 uppercase">
        {reading ? "Distance" : "Position"}
      </p>
      <p
        style={{ color: MEASURE_COLOR }}
        className="font-display mt-0.5 text-lg leading-tight font-semibold tabular-nums"
      >
        {reading ? `${mm(reading.distance)} mm` : coords(measurement.from.at)}
      </p>

      <dl className="mt-2.5 flex flex-col gap-1">
        {reading && measurement.to ? (
          <>
            <Line label="Δ x, y, z" value={`${mm(reading.dx)}, ${mm(reading.dy)}, ${mm(reading.dz)}`} />
            <Line label="Flat across" value={`${mm(reading.run)} mm`} />
            <Line label="Tilt from plate" value={deg(reading.tilt)} />
            <Line label="From the X axis" value={deg(reading.heading)} />
            <Line label="From" value={coords(measurement.from.at)} />
            <Line label="To" value={coords(measurement.to.at)} />
          </>
        ) : (
          <PlaceLines point={measurement.from.at} />
        )}
      </dl>

      <p className="mt-2.5 border-t border-ink-700 pt-2 text-[10px] leading-snug text-mist-500">
        Millimeters. x and y from the middle of the plate, z up from its surface.
      </p>
    </div>
  );
}

/** Where a single spot sits, said three ways, because different jobs want different ones. */
function PlaceLines({ point }: { point: PlatePoint }) {
  const spot = place(point);
  return (
    <>
      <Line label="Above the plate" value={`${mm(spot.height)} mm`} />
      <Line label="Out from middle" value={`${mm(spot.radius)} mm`} />
      <Line label="From the X axis" value={deg(spot.heading)} />
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-mist-500">{label}</dt>
      <dd className="text-[11px] font-medium text-mist-100 tabular-nums">{value}</dd>
    </div>
  );
}

/** One markup tool. Icon-only, because three labelled buttons would cover the model. */
function ToolButton({
  active,
  onClick,
  Glyph,
  label,
  tone = MARKUP_COLOR,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  Glyph: Icon;
  label: string;
  /** What the button lights up as — the same colour the tool draws in. */
  tone?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      style={active ? { backgroundColor: tone, color: tone === MARKUP_COLOR ? undefined : "#0b0e14" } : undefined}
      className={`rounded-lg p-2 transition disabled:opacity-35 disabled:hover:bg-transparent ${
        active ? "text-white" : "text-mist-300 hover:bg-ink-700 hover:text-mist-100"
      }`}
    >
      <Glyph size={17} weight="bold" />
    </button>
  );
}

/**
 * Which way to cut, and where.
 *
 * The slider is bounded strictly inside the model. A cut placed exactly on a face removes
 * everything and OpenSCAD renders an empty file, so the ends of this track are the one
 * place the control must not be able to reach.
 *
 * Moving it recompiles the model, which costs what a build costs — so the number follows
 * the thumb immediately and the render follows a moment behind it, rather than firing on
 * every pixel of a drag.
 */
function SectionControls({
  section,
  bounds,
  onChange,
}: {
  section: Section;
  bounds: Bounds;
  onChange: (section: Section) => void;
}) {
  const { min, max } = sectionRange(bounds, section.axis);
  const [draft, setDraft] = useState(section.position);

  useEffect(() => {
    if (draft === section.position) return;
    const timer = setTimeout(() => onChange({ axis: section.axis, position: draft }), 180);
    return () => clearTimeout(timer);
  }, [draft, section.axis, section.position, onChange]);

  return (
    <div className="absolute top-20 right-5 z-30 w-56 rounded-xl border border-ink-700 bg-ink-850/95 p-3 shadow-lg shadow-black/40 backdrop-blur">
      <p className="text-[10px] font-semibold tracking-[0.08em] text-mist-500 uppercase">
        Cut it open
      </p>

      <div className="mt-2 flex gap-1">
        {AXIS_LABELS.map(({ axis, label, hint }) => {
          const active = section.axis === axis;
          const range = sectionRange(bounds, axis);
          return (
            <button
              key={axis}
              title={hint}
              onClick={() => onChange({ axis, position: (range.min + range.max) / 2 })}
              style={active ? { backgroundColor: SECTION_COLOR, color: "#0b0e14" } : undefined}
              className={`flex-1 rounded-lg py-1 text-xs font-semibold transition ${
                active ? "" : "text-mist-400 hover:bg-ink-700 hover:text-mist-100"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={Math.max(0.05, (max - min) / 400)}
        value={draft}
        aria-label={`Where to cut along ${section.axis.toUpperCase()}`}
        onChange={(event) => setDraft(Number(event.target.value))}
        style={{ accentColor: SECTION_COLOR }}
        className="mt-3 w-full"
      />

      <p className="mt-1 text-center text-xs tabular-nums text-mist-400">
        {section.axis.toUpperCase()} = {mm(draft)} mm
      </p>

      <p className="mt-2 border-t border-ink-700 pt-2 text-[10px] leading-snug text-mist-500">
        The ruler still works — measure straight across a wall to see how thick it is.
      </p>
    </div>
  );
}
