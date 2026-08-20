"use client";

import { Button } from "@/components/Button/Button";
import Link from "next/link";

import type { CSSProperties, ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { AgentStatus } from "@/lib/types";
import { isPlainClick } from "@/lib/dashboard-route";
import { CardSurface } from "../CardSurface/CardSurface";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import styles from "./AgentCard.module.css";

export type AgentCardVariant = "agent" | "leader";

export interface AgentCardSurfaceProps {
  agentId: string;
  avatar?: string;
  avatarBadges?: Array<{
    icon: ReactNode;
    label: string;
    placement: "top" | "bottom";
    tone: "warning" | "info";
  }>;
  capability?: { label: string; detail: string };
  color?: string;
  initials: string;
  onConfigure?: (returnFocus: HTMLElement) => void;
  onPrefetch?: () => void;
  onPrimary?: (returnFocus: HTMLElement) => void;
  primaryHref?: string;
  primaryLabel: string;
  renderActions?: (triggerClassName: string) => ReactNode;
  settingsHref?: string;
  settingsLabel?: string;
  status: AgentStatus;
  title: string;
  variant: AgentCardVariant;
}

export function AgentCardSurface({
  agentId,
  avatar,
  avatarBadges = [],
  capability,
  color,
  initials,
  onConfigure,
  onPrefetch,
  onPrimary,
  primaryHref,
  primaryLabel,
  renderActions,
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
            onPointerEnter={onPrefetch}
            onFocus={onPrefetch}
            onClick={(event) => {
              if (isPlainClick(event)) event.preventDefault();
              onPrimary?.(event.currentTarget);
            }}
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
          {avatarBadges.map((badge) => <span
            key={badge.placement}
            className={styles.avatarBadge}
            data-placement={badge.placement}
            data-tone={badge.tone}
            role="img"
            aria-label={badge.label}
          >{badge.icon}</span>)}
        </span>
        <div className={styles.identity}>
          <h3>{title}</h3>
          <div className={styles.identityMeta}>
            <StatusIndicator status={status} size="compact" />
            {capability && <span className={styles.capability} title={capability.detail}>{capability.label}</span>}
          </div>
        </div>
        {renderActions
          ? renderActions(styles.configure)
          : onConfigure && (settingsHref
          ? <Link
              className={styles.configure}
              href={settingsHref}
              role="button"
              data-agent-configure-id={agentId}
              aria-label={settingsLabel}
              onClick={(event) => {
                if (isPlainClick(event)) event.preventDefault();
                onConfigure(event.currentTarget);
              }}
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
