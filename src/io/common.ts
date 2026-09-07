// Ported from openscad-playground
// https://github.com/openscad/openscad-playground/blob/main/src/io/common.ts

export type Vertex = {
  x: number;
  y: number;
  z: number;
}

export type Color = [number, number, number, number];

export type Face = {
  vertices: [number, number, number];
  colorIndex: number;
}

export type IndexedPolyhedron = {
  vertices: Vertex[];
  faces: Face[];
  colors: Color[];
}

export const DEFAULT_FACE_COLOR: Color = [0.5, 0.5, 0.5, 1];
