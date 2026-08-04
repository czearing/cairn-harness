"use client";

import { Button } from "@/components/Button/Button";

import { type KeyboardEvent, useRef } from "react";
import { BookOpen, Gauge, Shield, UserRound } from "lucide-react";
import { StatusIndicator, type StatusKind } from "../StatusIndicator/StatusIndicator";
import { autosaveLabel, type AutosaveState } from "./use-agent-autosave";
import styles from "./AgentWorkspace.module.css";

export type AgentSettingsSection = "instructions" | "profile" | "execution" | "controls";

interface Props {
  active: AgentSettingsSection;
  state: AutosaveState;
  error: string;
  onChange: (section: AgentSettingsSection) => void;
}

const sections = [
  { id: "instructions", label: "Instructions", icon: BookOpen },
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "execution", label: "Model", icon: Gauge },
  { id: "controls", label: "Controls", icon: Shield },
] as const;

const autosaveStatus: Record<AutosaveState, StatusKind> = {
  idle: "idle",
  dirty: "unsaved",
  saving: "saving",
  saved: "saved",
  error: "failed",
};

export function AgentSettingsNavigation({ active, state, error, onChange }: Props) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? sections.length - 1
        : (index + direction + sections.length) % sections.length;
    onChange(sections[nextIndex].id);
    tabs.current[nextIndex]?.focus();
  }

  return <nav className={styles.settingsRail} aria-label="Agent settings">
    <div className={styles.settingsTabs} role="tablist" aria-label="Agent settings sections">
      {sections.map((item, index) => {
        const Icon = item.icon;
        return <Button
          variant="inherit"
          key={item.id}
          ref={(node) => { tabs.current[index] = node; }}
          id={`agent-settings-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          aria-controls={`agent-settings-panel-${item.id}`}
          tabIndex={active === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => moveFocus(event, index)}
        >
          <Icon size={16} aria-hidden="true" />
          <strong>{item.label}</strong>
        </Button>;
      })}
    </div>
    {(state !== "idle" || error) && <div className={styles.railSaveState}>
      <StatusIndicator status={autosaveStatus[state]} label={autosaveLabel(state)} size="compact" announce />
      {error && <small role="alert">{error}</small>}
    </div>}
  </nav>;
}
