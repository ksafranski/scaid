/**
 * Writes the model as 3MF.
 *
 * STL is a list of loose triangles with no units and no colour. A slicer opening one has to
 * guess the file is in millimetres — it usually guesses right, and "usually" is doing work
 * there — and a model the agent deliberately coloured to show its parts arrives grey. 3MF
 * carries both, and every current slicer prefers it.
 *
 * It is written here rather than asked for, because the WebAssembly OpenSCAD this app ships
 * cannot produce one: `--export-format=3mf` is accepted, renders without complaint, and
 * writes a zero-byte file, lib3mf having been left out of the build. That turns out to be
 * the better answer anyway — written from the same mesh the viewer is showing, what lands on
 * disk is exactly what was on screen, colours included.
 *
 * A 3MF is an OPC package, which is a ZIP holding three files: what types are inside, what
 * the package starts from, and the model itself. `zip.ts` already writes a stored-entry ZIP,
 * and stored entries are a legal ZIP — the archive is larger than a compressed one would be,
 * by an amount no slicer will ever notice.
 */
import { zipStore, type ZipEntry } from "./zip";
import { DEFAULT_FACE_COLOR, type Color, type IndexedPolyhedron } from "@/io/common";

const CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MATERIAL_NS = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";

/** Ids are only unique within the file; these are simply the three things in it. */
const COLOR_GROUP_ID = 1;
const OBJECT_ID = 2;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;

/**
 * A number, short.
 *
 * Six decimals is far finer than a printer can place a nozzle, and trimming what they leave
 * behind takes a third off the file — which matters because every vertex is written as text.
 */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(6)));
}

function hex(component: number): string {
  return Math.max(0, Math.min(255, Math.round(component * 255)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

/** sRGB as 3MF wants it: #RRGGBB, with alpha only when there is any to report. */
function colorText(color: Color): string {
  const [r, g, b, a = 1] = color;
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a) : ""}`;
}

function isDefault(color: Color): boolean {
  return (
    color[0] === DEFAULT_FACE_COLOR[0] &&
    color[1] === DEFAULT_FACE_COLOR[1] &&
    color[2] === DEFAULT_FACE_COLOR[2]
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The model document.
 *
 * Coordinates go out as the renderer produced them, which is what the STL export does too —
 * a slicer places an object on its own bed however it arrives, and having the two downloads
 * disagree about where the model sits would be its own small mystery.
 */
function modelXml(mesh: IndexedPolyhedron, name: string): string {
  // A model nobody coloured is not grey; it has no colour. Saying grey would tell a slicer
  // to print it grey, over the top of whatever they actually loaded.
  const painted = mesh.colors.length > 0 && !mesh.colors.every(isDefault);

  const vertices = mesh.vertices
    .map((v) => `     <vertex x="${num(v.x)}" y="${num(v.y)}" z="${num(v.z)}" />`)
    .join("\n");

  const triangles = mesh.faces
    .map((face) => {
      const [a, b, c] = face.vertices;
      const paint = painted ? ` p1="${face.colorIndex}"` : "";
      return `     <triangle v1="${a}" v2="${b}" v3="${c}"${paint} />`;
    })
    .join("\n");

  const colorGroup = painted
    ? `    <m:colorgroup id="${COLOR_GROUP_ID}">
${mesh.colors.map((color) => `     <m:color color="${colorText(color)}" />`).join("\n")}
    </m:colorgroup>
`
    : "";

  const paintedObject = painted ? ` pid="${COLOR_GROUP_ID}" pindex="0"` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:m="${MATERIAL_NS}">
  <metadata name="Title">${escapeXml(name)}</metadata>
  <metadata name="Application">Scaid</metadata>
  <resources>
${colorGroup}    <object id="${OBJECT_ID}" type="model"${paintedObject}>
    <mesh>
     <vertices>
${vertices}
     </vertices>
     <triangles>
${triangles}
     </triangles>
    </mesh>
    </object>
  </resources>
  <build>
    <item objectid="${OBJECT_ID}" />
  </build>
</model>
`;
}

export function export3mf(mesh: IndexedPolyhedron, name: string): Blob {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    // First on purpose: it is the file that says what everything else in here is.
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(RELATIONSHIPS) },
    { name: "3D/3dmodel.model", data: encoder.encode(modelXml(mesh, name)) },
  ];

  return new Blob([zipStore(entries)], {
    type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  });
}
