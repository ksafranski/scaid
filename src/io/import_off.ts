// Ported from openscad-playground
// https://github.com/openscad/openscad-playground/blob/main/src/io/import_off.ts

import { Color, DEFAULT_FACE_COLOR, Face, IndexedPolyhedron, Vertex } from './common';

/** Colors round-trip through 0-255 integers, so an exact-ish match is all we need. */
const COLOR_EPSILON = 2 / 255;

function isRequested(color: Color, requested: Color[]): boolean {
  return requested.some(
    (want) =>
      Math.abs(color[0] - want[0]) < COLOR_EPSILON &&
      Math.abs(color[1] - want[1]) < COLOR_EPSILON &&
      Math.abs(color[2] - want[2]) < COLOR_EPSILON,
  );
}

/**
 * @param requestedColors colors the source explicitly asked for via color(...). Any face
 *   painted something else is wearing an OpenSCAD default and is flattened to gray.
 */
export function parseOff(content: string, requestedColors: Color[] = []): IndexedPolyhedron {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
  
  if (lines.length === 0) throw new Error('Empty OFF file');

  // The header is either "OFF 8 6 0" on one line, or "OFF" with the counts on the next.
  // Test for the counts being present before assuming they're on the header line, or a
  // bare "OFF" reads its counts out of an empty string and every one of them is NaN.
  let counts: string;
  let currentLine = 0;
  if (lines[0].match(/^OFF\s+\S/)) {
    counts = lines[0].substring(3).trim();
    currentLine = 1;
  } else if (lines[0] === 'OFF' && lines.length > 1) {
    counts = lines[1];
    currentLine = 2;
  } else {
    throw new Error('Invalid OFF file: missing OFF header');
  }

  const [numVertices, numFaces] = counts.split(/\s+/).map(Number);
  if (isNaN(numVertices) || isNaN(numFaces)) throw new Error('Invalid OFF file: invalid vertex or face counts');

  if (currentLine + numVertices + numFaces > lines.length) throw new Error('Invalid OFF file: not enough lines');

  const vertices: Vertex[] = [];
  for (let i = 0; i < numVertices; i++) {
    const parts = lines[currentLine + i].split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some(isNaN)) throw new Error(`Invalid OFF file: invalid vertex at line ${currentLine + i + 1}`);
    vertices.push({ x: parts[0], y: parts[1], z: parts[2] });
  }
  currentLine += numVertices;

  const colors: Color[] = [];
  const colorMap = new Map<string, number>();

  const faces: Face[] = [];
  for (let i = 0; i < numFaces; i++) {
    const parts = lines[currentLine + i].split(/\s+/).map(Number);
    const numVerts = parts[0];
    const faceVertices = parts.slice(1, numVerts + 1);
    const colorPartsRaw = parts.length >= numVerts + 4
      ? parts.slice(numVerts + 1, numVerts + 5).map(c => c / 255)
      : DEFAULT_FACE_COLOR;

    const colorParts: Color = [
      colorPartsRaw[0] ?? DEFAULT_FACE_COLOR[0],
      colorPartsRaw[1] ?? DEFAULT_FACE_COLOR[1],
      colorPartsRaw[2] ?? DEFAULT_FACE_COLOR[2],
      colorPartsRaw[3] ?? DEFAULT_FACE_COLOR[3]
    ];

    const color = isRequested(colorParts, requestedColors) ? colorParts : DEFAULT_FACE_COLOR;
    if (faceVertices.length < 3) throw new Error(`Invalid OFF file: face at line ${currentLine + i + 1} must have at least 3 vertices`);

    const colorKey = color ? color.join(',') : '';
    let colorIndex = colorMap.get(colorKey);
    if (colorIndex == null) {
      colorIndex = colors.length;
      const [r, g, b, a] = color;
      colors.push([r, g, b, a ?? 1]);
      colorMap.set(colorKey, colorIndex);
    }

    if (faceVertices.length == 3) {
      faces.push({
        vertices: faceVertices as [number, number, number],
        colorIndex
      });
    } else {
      // Triangulate the face
      for (let j = 1; j < faceVertices.length - 1; j++) {
        faces.push({
          vertices: [faceVertices[0], faceVertices[j], faceVertices[j + 1]],
          colorIndex
        });
      }   
    }
  }

  return { vertices, faces, colors };
}
