"use client";

import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { layerStyle, type Layer } from "@/lib/layers";

interface PortalLayerProps {
  "data-overlay-layer": Layer;
  style: CSSProperties;
}

export function OverlayPortal({ layer, children }: {
  layer: Layer;
  children: (props: PortalLayerProps) => ReactNode;
}) {
  return createPortal(children({
    "data-overlay-layer": layer,
    style: layerStyle(layer),
  }), document.body);
}
