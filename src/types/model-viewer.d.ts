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
