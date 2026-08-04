import type { HTMLAttributes, ReactNode } from "react";
import styles from "./DashboardPane.module.css";

type PaneElement = "aside" | "section";

interface DashboardPaneProps extends HTMLAttributes<HTMLElement> {
  as?: PaneElement;
  children: ReactNode;
  className?: string;
  tone?: "navigation" | "utility" | "workspace";
}

interface PaneSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

function classes(base: string, className?: string) {
  return className ? `${base} ${className}` : base;
}

export function DashboardPane({
  as: Element = "aside",
  children,
  className,
  tone = "utility",
  ...props
}: DashboardPaneProps) {
  return <Element className={classes(styles.pane, className)} data-pane-tone={tone} {...props}>{children}</Element>;
}

export function DashboardPaneHeader({ children, className, ...props }: PaneSectionProps) {
  return <div className={classes(styles.header, className)} {...props}>{children}</div>;
}

export function DashboardPaneBody({ children, className, ...props }: PaneSectionProps) {
  return <div className={classes(styles.body, className)} {...props}>{children}</div>;
}

export function DashboardPaneFooter({ children, className, ...props }: PaneSectionProps) {
  return <div className={classes(styles.footer, className)} {...props}>{children}</div>;
}

interface PaneSectionLabelProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  text: string;
  action?: ReactNode;
  className?: string;
}

export function DashboardPaneSectionLabel({ text, action, className, ...props }: PaneSectionLabelProps) {
  return <div className={classes(styles.sectionLabel, className)} data-pane-section-label {...props}>
    <span>{text}</span>
    {action}
  </div>;
}
