import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Typography.module.css";

export type TypographyVariant =
  | "display"
  | "titleLarge"
  | "title"
  | "heading"
  | "body"
  | "bodySmall"
  | "label"
  | "caption"
  | "eyebrow"
  | "mono";

export type TypographyTone = "default" | "muted" | "subtle" | "accent" | "danger" | "warning";

type TypographyElement = "div" | "h1" | "h2" | "h3" | "h4" | "p" | "small" | "span" | "strong";

interface TypographyProps extends HTMLAttributes<HTMLElement> {
  as?: TypographyElement;
  children: ReactNode;
  variant?: TypographyVariant;
  tone?: TypographyTone;
}

export function Typography({
  as: Element = "span",
  children,
  className,
  variant = "body",
  tone = "default",
  ...props
}: TypographyProps) {
  return <Element className={[styles.base, styles[variant], styles[tone], className].filter(Boolean).join(" ")} {...props}>
    {children}
  </Element>;
}

export function TypographyProvider({ children }: { children: ReactNode }) {
  return <div className={styles.provider}>{children}</div>;
}
