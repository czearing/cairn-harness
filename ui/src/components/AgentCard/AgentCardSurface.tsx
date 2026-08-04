"use client";

import { Button } from "@/components/Button/Button";
import Link from "next/link";

import type { CSSProperties, ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { AgentStatus } from "@/lib/types";
import { CardSurface } from "../CardSurface/CardSurface";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./AgentCard.module.css";

export type AgentCardVariant = "agent" | "leader";

export interface AgentCardSurfaceProps {
  agentId: string;
  avatar?: string;
  avatarBadge?: ReactNode;
  avatarBadgeLabel?: string;
  avatarBadgePlacement?: "top" | "bottom";
  avatarBadgeTone?: "warning" | "info";
  color?: string;
  initials: string;
  onConfigure?: (returnFocus: HTMLElement) => void;
  onPrefetch?: () => void;
  onPrimary?: (returnFocus: HTMLElement) => void;
  primaryHref?: string;
  primaryLabel: string;
  settingsHref?: string;
  settingsLabel?: string;
  status: AgentStatus;
  title: string;
  variant: AgentCardVariant;
}

export function AgentCardSurface({
  agentId,
  avatar,
  avatarBadge,
  avatarBadgeLabel,
  avatarBadgePlacement = "top",
  avatarBadgeTone = "info",
  color,
  initials,
  onConfigure,
  onPrefetch,
  onPrimary,
  primaryHref,
  primaryLabel,
  settingsHref,
  settingsLabel = "Settings",
  status,
  title,
  variant,
}: AgentCardSurfaceProps) {
  const identity = { "--agent-color": color } as CSSProperties;

  return <div className={styles.container}>
    <CardSurface
      className={styles.card}
      data-agent-variant={variant}
      interactive
      style={identity}
      tone={variant === "leader" ? "warning" : "neutral"}
    >
      {primaryHref
        ? <Link
            className={styles.hit}
            href={primaryHref}
            role="button"
            data-agent-id={agentId}
            aria-label={primaryLabel}
            onClick={(event) => onPrimary?.(event.currentTarget)}
          />
        : <Button
            variant="inherit"
            className={styles.hit}
            type="button"
            data-agent-id={agentId}
            aria-label={primaryLabel}
            onPointerEnter={onPrefetch}
            onClick={(event) => onPrimary?.(event.currentTarget)}
          />}
      <div className={styles.cardHeader}>
        <span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>
          {!avatar && initials}
          {avatarBadge && <span
            className={styles.avatarBadge}
            data-placement={avatarBadgePlacement}
            data-tone={avatarBadgeTone}
            role="img"
            aria-label={avatarBadgeLabel}
          >{avatarBadge}</span>}
        </span>
        <div className={styles.identity}>
          <h3>{title}</h3>
          <StatusIndicator status={status} size="compact" />
        </div>
        {onConfigure && (settingsHref
          ? <Link
              className={styles.configure}
              href={settingsHref}
              role="button"
              data-agent-configure-id={agentId}
              aria-label={settingsLabel}
              onClick={(event) => onConfigure(event.currentTarget)}
            >
              <Settings2 size={15} aria-hidden="true" />
            </Link>
          : <Button
              variant="inherit"
              className={styles.configure}
              type="button"
              data-agent-configure-id={agentId}
              aria-label={settingsLabel}
              onClick={(event) => onConfigure(event.currentTarget)}
            >
              <Settings2 size={15} aria-hidden="true" />
            </Button>)}
      </div>
    </CardSurface>
  </div>;
}
