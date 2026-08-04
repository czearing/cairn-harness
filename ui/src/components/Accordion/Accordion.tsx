"use client";

import { useState, type PropsWithChildren, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./Accordion.module.css";

interface Props extends PropsWithChildren {
  className?: string;
  defaultOpen?: boolean;
  icon?: ReactNode;
  label: ReactNode;
}

export function Accordion({
  children,
  className = "",
  defaultOpen = false,
  icon,
  label,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return <details
    className={`${styles.accordion} ${className}`}
    data-accordion
    open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}
  >
    <summary className={styles.summary}>
      <ChevronRight className={styles.chevron} size={14} aria-hidden />
      {icon && <span className={styles.icon}>{icon}</span>}
      <span>{label}</span>
    </summary>
    {open && <div className={styles.content}>{children}</div>}
  </details>;
}
