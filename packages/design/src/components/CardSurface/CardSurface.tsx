import type { HTMLAttributes, ReactNode } from "react";
import styles from "./CardSurface.module.css";

export type CardSurfaceTone = "neutral" | "accent" | "warning" | "danger";

interface Props extends HTMLAttributes<HTMLElement> {
  as?: "article" | "section";
  children: ReactNode;
  interactive?: boolean;
  tone?: CardSurfaceTone;
}

export function CardSurface({
  as: Element = "article",
  children,
  className = "",
  interactive = false,
  tone = "neutral",
  ...props
}: Props) {
  return <Element
    {...props}
    className={`${styles.surface} ${className}`}
    data-card-interactive={interactive || undefined}
    data-card-tone={tone}
  >
    {children}
  </Element>;
}
