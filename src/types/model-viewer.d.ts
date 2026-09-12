/**
 * Ambient JSX typing for the <model-viewer> custom element.
 *
 * This file must stay a module (note the exports below) so that `declare module "react"`
 * *augments* React's types rather than replacing them.
 */
import type * as React from "react";

export interface ModelViewerElement extends HTMLElement {
  /** True once the current src has finished decoding. */
  readonly loaded: boolean;
  cameraOrbit: string;
  cameraTarget: string;
  fieldOfView: string;
  jumpCameraToGoal(): void;
  /**
   * Where the camera is now, rather than where it was last told to go.
   *
   * The setters above take a goal the camera animates towards, and a person dragging the
   * model moves it without touching them — so these are the only way to read a view back,
   * which is what putting one back afterwards needs.
   */
  getCameraOrbit(): { theta: number; phi: number; radius: number };
  getCameraTarget(): Vector3D;
  /** Vertical field of view in degrees, resolved — `fieldOfView` may say "auto". */
  getFieldOfView(): number;
  /** Snapshot of the rendered canvas — how a circled region gets its picture. */
  toDataURL(type?: string, encoderOptions?: number): string;
  /**
   * Where a pixel lands on the model, in the model's own coordinates — millimeters scaled
   * by 0.001, Z up, as the GLB was written. Null when the ray misses everything.
   */
  positionAndNormalFromPoint(
    pixelX: number,
    pixelY: number,
  ): { position: Vector3D; normal: Vector3D } | null;
  /**
   * Where a slotted hotspot currently sits on screen, in CSS pixels from the element's
   * top-left. This is the only way back from model coordinates to the overlay, so it is
   * what lets a measurement stay on its spot while the model turns.
   */
  queryHotspot(name: string): { canvasPosition: Vector3D; facingCamera: boolean } | null;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface ModelViewerProps extends React.HTMLAttributes<HTMLElement> {
  src?: string;
  alt?: string;
  "camera-controls"?: boolean;
  "shadow-intensity"?: string;
  "shadow-softness"?: string;
  "environment-image"?: string;
  "tone-mapping"?: string;
  "camera-orbit"?: string;
  "camera-target"?: string;
  "field-of-view"?: string;
  "min-camera-orbit"?: string;
  "max-camera-orbit"?: string;
  "interaction-prompt"?: string;
  "disable-tap"?: boolean;
  orientation?: string;
  exposure?: string;
  ref?: React.Ref<ModelViewerElement>;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerProps;
    }
  }
}
