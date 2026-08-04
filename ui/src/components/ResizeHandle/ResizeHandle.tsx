"use client";

import { useRef, useState } from "react";
import styles from "./ResizeHandle.module.css";

interface Props {
  orientation: "horizontal" | "vertical";
  direction?: 1 | -1;
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  className?: string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: (value: number) => void;
}

interface DragState {
  pointerId: number;
  startPosition: number;
  startValue: number;
  value: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function ResizeHandle({
  orientation,
  direction = 1,
  label,
  controls,
  value,
  min,
  max,
  defaultValue,
  className,
  onPreview,
  onCommit,
  onCancel,
}: Props) {
  const drag = useRef<DragState | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const position = (event: React.PointerEvent<HTMLDivElement>) => orientation === "vertical" ? event.clientX : event.clientY;

  function cancelDrag(target: HTMLDivElement) {
    const current = drag.current;
    if (!current) return;
    if (target.hasPointerCapture(current.pointerId)) target.releasePointerCapture(current.pointerId);
    drag.current = undefined;
    setDragging(false);
    onCancel(current.startValue);
  }

  return <div
    className={className ? `${styles.handle} ${className}` : styles.handle}
    role="separator"
    tabIndex={0}
    aria-label={label}
    aria-controls={controls}
    aria-orientation={orientation}
    aria-valuemin={Math.round(min)}
    aria-valuemax={Math.round(max)}
    aria-valuenow={Math.round(value)}
    data-orientation={orientation}
    data-dragging={dragging || undefined}
    onDoubleClick={() => onCommit(clamp(defaultValue, min, max))}
    onKeyDown={(event) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        cancelDrag(event.currentTarget);
        return;
      }
      let next: number | undefined;
      if (event.key === "Home") next = min;
      if (event.key === "End") next = max;
      const decreaseKey = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
      const increaseKey = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
      if (event.key === decreaseKey || event.key === increaseKey) {
        const step = event.shiftKey ? 32 : 8;
        const physicalDelta = event.key === increaseKey ? step : -step;
        next = value + physicalDelta * direction;
      }
      if (next === undefined) return;
      event.preventDefault();
      onCommit(clamp(next, min, max));
    }}
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startPosition: position(event),
        startValue: value,
        value,
      };
      setDragging(true);
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.value = clamp(current.startValue + (position(event) - current.startPosition) * direction, min, max);
      onPreview(current.value);
    }}
    onPointerUp={(event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      drag.current = undefined;
      setDragging(false);
      onCommit(current.value);
    }}
    onPointerCancel={(event) => {
      if (drag.current?.pointerId === event.pointerId) cancelDrag(event.currentTarget);
    }}
  />;
}
