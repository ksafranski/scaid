// Ported from openscad-playground
// https://github.com/openscad/openscad-playground/blob/main/src/io/export_glb.ts

import { Document, WebIO, Accessor, Primitive } from '@gltf-transform/core';
import { KHRLightsPunctual, Light as LightDef } from '@gltf-transform/extensions';
import { Color, Face, IndexedPolyhedron } from './common';

type Geom = {
  positions: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array;
};

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function convertColor(color: Color): Color {
  return [
    srgbToLinear(color[0]),
    srgbToLinear(color[1]),
    srgbToLinear(color[2]),
    color[3]
  ];
}

function createPrimitive(doc: Document, baseColorFactor: Color, {positions, indices}: Geom): Primitive {
  const prim = doc.createPrimitive()
    .setMode(Primitive.Mode.TRIANGLES)
    .setMaterial(
      doc.createMaterial()
        .setDoubleSided(true)
        .setAlphaMode(baseColorFactor[3] < 1 ? 'BLEND' : 'OPAQUE')
        .setMetallicFactor(0.0)
        // Matte enough to read as printed plastic, glossy enough that the environment
        // slides across a curve instead of sitting on it as one flat tone. At 0.6 a white
        // sphere came out as a flat white disc; much below 0.5 and a dark one turns into a
        // mirror showing the room it isn't in.
        .setRoughnessFactor(0.5)
        .setBaseColorFactor(convertColor(baseColorFactor)))
    .setAttribute('POSITION',
      doc.createAccessor()
        .setType(Accessor.Type.VEC3)
        // @ts-expect-error - TypedArray type mismatch with @gltf-transform types
        .setArray(positions))  
    .setIndices(
      doc.createAccessor()
        .setType(Accessor.Type.SCALAR)
        // @ts-expect-error - TypedArray type mismatch with @gltf-transform types
        .setArray(indices));
  return prim;
}

function getGeom(data: IndexedPolyhedron): Geom {
  const positions = new Float32Array(data.vertices.length * 3);
  const indices = new Uint32Array(data.faces.length * 3);

  const addedVertices = new Map<number, number>();
  let verticesAdded = 0;
  const addVertex = (i: number) => {
    let index = addedVertices.get(i);
    if (index === undefined) {
      const offset = verticesAdded * 3;
      const vertex = data.vertices[i];
      positions[offset] = vertex.x;
      positions[offset + 1] = vertex.y;
      positions[offset + 2] = vertex.z;
      index = verticesAdded++;
      addedVertices.set(i, index);
    }
    return index;
  };

  data.faces.forEach((face, i) => {
    const { vertices } = face;
    if (vertices.length < 3) throw new Error('Face must have at least 3 vertices');

    const offset = i * 3;
    indices[offset] = addVertex(vertices[0]);
    indices[offset + 1] = addVertex(vertices[1]);
    indices[offset + 2] = addVertex(vertices[2]);
  });
  return {
    positions: positions.slice(0, verticesAdded * 3),
    indices
  };
}

export async function exportGlb(data: IndexedPolyhedron, buildPlateSizeMm: number = 250): Promise<Blob> {
  const doc = new Document();
  const lightExt = doc.createExtension(KHRLightsPunctual);
  doc.createBuffer();

  /**
   * A key and a fill, far apart in strength.
   *
   * What makes a shape readable is the difference between its faces, not how much light
   * there is — and a pale object lit evenly from two sides has no differences left. The
   * old pair were close enough in strength (1.5 and 0.5) that a light grey tray came out
   * as one flat silhouette: top, wall and floor all the same value.
   *
   * So the key does most of the work and the fill only keeps the shadowed faces from
   * going to black. The environment supplies the rest of the ambient.
   */
  const scene = doc.createScene()
    .addChild(doc.createNode()
      .setExtension('KHR_lights_punctual', lightExt
        .createLight()
        .setType(LightDef.Type.DIRECTIONAL)
        .setIntensity(2.6)
        // Barely warm. Enough to separate the lit faces from the shaded ones by hue as
        // well as by brightness, which is what the eye actually reads form from — and far
        // too little to misreport a colour the program asked for.
        .setColor([1.0, 0.985, 0.96]))
      .setRotation([-0.3250576, -0.3250576, 0, 0.8880739]))
    .addChild(doc.createNode()
      .setExtension('KHR_lights_punctual', lightExt
        .createLight()
        .setType(LightDef.Type.DIRECTIONAL)
        .setIntensity(0.28)
        .setColor([0.94, 0.96, 1.0]))
      .setRotation([0.6279631, 0.6279631, 0, 0.4597009]));

  const mesh = doc.createMesh();

  const facesByColor = new Map<number, Face[]>();
  data.faces.forEach(face => {
    let faces = facesByColor.get(face.colorIndex);
    if (!faces) facesByColor.set(face.colorIndex, faces = []);
    faces.push(face);
  });
  
  for (const [colorIndex, faces] of facesByColor.entries()) {
    const color = data.colors[colorIndex];
    mesh.addPrimitive(
      createPrimitive(doc, color, getGeom({ vertices: data.vertices, faces, colors: data.colors })));
  }
  scene.addChild(doc.createNode().setMesh(mesh));

  // Calculate bounding box for dynamic grid positioning
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  data.vertices.forEach(v => {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  });

  // If no vertices, use defaults
  if (data.vertices.length === 0) {
    minX = -50; maxX = 50; minY = -50; maxY = 50; minZ = 0; maxZ = 0;
  }

  // Create the Ground/Grid system (Build Plate style)
  const SCALE = 0.001; // 1 unit = 1mm. 
  const buildPlateSize = buildPlateSizeMm * SCALE; 
  const majorStep = 0.05; // 5cm
  const minorStep = 0.01; // 1cm
  const gridZ = 0; 

  const majorPositions: number[] = [];
  const minorPositions: number[] = [];
  const axisPositions: number[] = [];

  const half = buildPlateSize / 2;
  const epsilon = 0.00001;

  for (let i = -half; i <= half + epsilon; i += minorStep) {
    const isMajor = Math.abs(i % majorStep) < epsilon || Math.abs((i % majorStep) - majorStep) < epsilon || Math.abs((i % majorStep) + majorStep) < epsilon;
    const isCenter = Math.abs(i) < epsilon;
    const isEdge = Math.abs(i - half) < epsilon || Math.abs(i + half) < epsilon;

    if (isCenter) continue;

    if (isMajor || isEdge) {
      majorPositions.push(i, -half, gridZ, i, half, gridZ);
      majorPositions.push(-half, i, gridZ, half, i, gridZ);
    } else {
      minorPositions.push(i, -half, gridZ, i, half, gridZ);
      minorPositions.push(-half, i, gridZ, half, i, gridZ);
    }
  }

  // Explicit Border (Solid white/bright)
  const borderPositions = [
    -half, -half, gridZ,  half, -half, gridZ,
     half, -half, gridZ,  half,  half, gridZ,
     half,  half, gridZ, -half,  half, gridZ,
    -half,  half, gridZ, -half, -half, gridZ
  ];

  // Axes
  axisPositions.push(0, -half, gridZ, 0, half, gridZ); // Y
  axisPositions.push(-half, 0, gridZ, half, 0, gridZ); // X

  const addGridLayer = (
    name: string,
    pos: number[],
    color: Color,
    mode: Parameters<Primitive['setMode']>[0] = Primitive.Mode.LINES,
  ) => {
    if (pos.length === 0) return;
    const mesh = doc.createMesh();
    const prim = doc.createPrimitive()
      .setMode(mode)
      .setMaterial(doc.createMaterial()
        .setBaseColorFactor(convertColor(color))
        .setAlphaMode('OPAQUE')
        .setDoubleSided(true)
        .setRoughnessFactor(1)
        .setMetallicFactor(0))
      .setAttribute('POSITION', doc.createAccessor()
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array(pos)));
    mesh.addPrimitive(prim);
    // `noHit` keeps the ruler off the grid. model-viewer raycasts the whole scene, and
    // three treats a line as hit whenever the ray passes within a threshold of it — a
    // threshold measured in scene units, where this entire plate is a quarter of one. Every
    // pick would land on a grid line instead of the model without this.
    scene.addChild(doc.createNode().setName(name).setMesh(mesh).setExtras({ noHit: true }));
  };

  // Tuned for the dark studio background: dark-on-dark would be invisible. Kept dim enough
  // that the grid reads as a reference surface and never competes with the model.
  addGridLayer('MinorGrid', minorPositions, [0.16, 0.18, 0.23, 1.0]);
  addGridLayer('MajorGrid', majorPositions, [0.26, 0.30, 0.38, 1.0]);
  addGridLayer('Axes', axisPositions, [0.40, 0.44, 0.54, 1.0]);
  addGridLayer('Border', borderPositions, [0.50, 0.46, 0.72, 1.0]);

  // Remove the floor entirely as it might be occluding the lines
  // We'll rely on the grid lines themselves as the reference

  // Scale and Lift the model so it sits ON the ground.
  // SCAD's minZ value tells us how much we need to offset the model to get it to Z=0.
  // If minZ is -12, we need to add 12 to every Z vertex.
  const zOffset = -minZ; 

  mesh.listPrimitives().forEach(p => {
    const attr = p.getAttribute('POSITION');
    if (attr) {
      const array = attr.getArray() as Float32Array;
      for (let i = 0; i < array.length; i += 3) {
        array[i] *= SCALE;         // X
        array[i + 1] *= SCALE;     // Y
        array[i + 2] = (array[i + 2] + zOffset) * SCALE; // Z (Shifted to 0 then scaled)
      }
      // @ts-expect-error - TypedArray type mismatch with @gltf-transform types
      attr.setArray(array);
    }
  });

  // Use WebIO for browser compatibility (instead of NodeIO)
  const glb = await new WebIO().registerExtensions([KHRLightsPunctual]).writeBinary(doc);
  return new Blob([glb], { type: 'model/gltf-binary' });
}
