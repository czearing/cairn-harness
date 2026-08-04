import type { CSSProperties } from "react";

export const layers = {
  menu: 100,
  popup: 120,
  notification: 200,
  drawer: 300,
  modal: 400,
  tooltip: 500,
} as const;

export type Layer = keyof typeof layers;
type LayerVariable = `--layer-${Layer}`;
export type LayerVariables = CSSProperties & Record<LayerVariable, number>;

export const layerVariables: LayerVariables = {
  "--layer-menu": layers.menu,
  "--layer-popup": layers.popup,
  "--layer-notification": layers.notification,
  "--layer-drawer": layers.drawer,
  "--layer-modal": layers.modal,
  "--layer-tooltip": layers.tooltip,
};

export function layerStyle(layer: Layer): CSSProperties {
  return { zIndex: layers[layer] };
}
