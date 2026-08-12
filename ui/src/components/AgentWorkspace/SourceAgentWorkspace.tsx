"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { AgentWorkspaceProps } from "./agent-workspace-types";
import { MarkdownEditor } from "../MarkdownEditor/MarkdownEditor";
import { AgentRuntimeActions } from "./WorkspaceActions";
import { AppearanceSection, IdentitySection, ModelSection } from "./WorkspaceFields";
import { AgentSettingsNavigation, type AgentSettingsSection } from "./AgentSettingsNavigation";
import { useAgentAutosave } from "./use-agent-autosave";
import styles from "./AgentWorkspace.module.css";

export interface SourceAgentWorkspaceHandle {
  requestClose: () => Promise<boolean>;
}

export const SourceAgentWorkspace = forwardRef<SourceAgentWorkspaceHandle, Omit<AgentWorkspaceProps, "onBack" | "onConversation">>(
  function SourceAgentWorkspace({
    agent,
    settings,
    settingsError,
    color,
    avatar,
    onColor,
    onAvatar,
    onSaveDetails,
    onSaveInstructions,
    onSaveModel,
    onRetryModels,
    onMakeLeader,
    onPauseToggle,
    onReset,
    onDelete,
    onDeletionPreview,
    onDelegateToggle,
  }, ref) {
    const promptRegion = useRef<HTMLElement>(null);
    const workspaceContent = useRef<HTMLDivElement>(null);
    const [section, setSection] = useState<AgentSettingsSection>("instructions");
    const prompt = useAgentAutosave(
      { prompt: agent.prompt || "" },
      onSaveInstructions,
      (value) => value.prompt.trim() ? "" : "Prompt instructions are required.",
    );
    const details = useAgentAutosave(
      { title: agent.title || agent.id, description: agent.role || "" },
      onSaveDetails,
      (value) => !value.title.trim() ? "Title is required." : !value.description.trim() ? "Description is required." : "",
    );
    const model = useAgentAutosave(
      agent.model,
      onSaveModel,
      () => "",
    );
    useImperativeHandle(ref, () => ({
      async requestClose() {
        const [promptSaved, detailsSaved, modelSaved] = await Promise.all([
          prompt.flush(true),
          details.flush(true),
          model.flush(true),
        ]);
        if (!promptSaved) {
          setSection("instructions");
          requestAnimationFrame(() => promptRegion.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus());
        }
        return promptSaved && detailsSaved && modelSaved;
      },
    }), [details, model, prompt]);

    const status = prompt.error || details.error || model.error;
    const combinedState = status
      ? "error"
      : [prompt.state, details.state, model.state].includes("saving")
        ? "saving"
        : [prompt.state, details.state, model.state].includes("dirty")
          ? "dirty"
          : [prompt.state, details.state, model.state].includes("saved")
            ? "saved"
            : "idle";

    function changeSection(nextSection: AgentSettingsSection) {
      setSection(nextSection);
      requestAnimationFrame(() => {
        const workspace = workspaceContent.current?.closest<HTMLElement>("main");
        workspace?.scrollTo({ top: 0, behavior: "auto" });
        workspace?.scrollIntoView({ block: "start", behavior: "auto" });
      });
    }

    return <div className={styles.sourceWorkspace}>
      <AgentSettingsNavigation active={section} state={combinedState} error={status} onChange={changeSection} />
      <div ref={workspaceContent} className={styles.settingsPanels}>
        <section
          ref={promptRegion}
          id="agent-settings-panel-instructions"
          className={styles.settingsPanel}
          role="tabpanel"
          aria-labelledby="agent-settings-tab-instructions"
          hidden={section !== "instructions"}
        >
          <header className={styles.panelHeader}>
            <h2 id="agent-prompt-title">Instructions</h2>
            <p>Define this agent&apos;s role and operating rules.</p>
          </header>
          <div className={styles.promptSurface}>
            <MarkdownEditor
              initialMarkdown={agent.prompt || ""}
              onChange={(nextPrompt) => prompt.change({ prompt: nextPrompt })}
              label={`${agent.title || agent.id} prompt instructions`}
              placeholder="Describe what this agent owns, how it should work, and what a successful result includes."
              layout="workspace"
            />
          </div>
        </section>

        <section
          id="agent-settings-panel-profile"
          className={styles.settingsPanel}
          role="tabpanel"
          aria-labelledby="agent-settings-tab-profile"
          hidden={section !== "profile"}
        >
          <header className={styles.panelHeader}>
            <h2>Profile</h2>
          </header>
          <div className={styles.settingsGrid}>
            <IdentitySection agent={agent} onChange={(value) => details.change(value)} />
            <AppearanceSection agent={agent} color={color} avatar={avatar} onColor={onColor} onAvatar={onAvatar} />
          </div>
        </section>

        <section
          id="agent-settings-panel-execution"
          className={styles.settingsPanel}
          role="tabpanel"
          aria-labelledby="agent-settings-tab-execution"
          hidden={section !== "execution"}
        >
          <div className={styles.settingsGrid}>
            <ModelSection agent={agent} settings={settings} settingsError={settingsError} onChange={(value) => model.change(value, 0)} onRetry={onRetryModels} />
          </div>
        </section>

        <section
          id="agent-settings-panel-controls"
          className={styles.settingsPanel}
          role="tabpanel"
          aria-labelledby="agent-settings-tab-controls"
          hidden={section !== "controls"}
        >
          <header className={styles.panelHeader}>
            <h2>Controls</h2>
          </header>
          <AgentRuntimeActions agent={agent} onMakeLeader={onMakeLeader} onPauseToggle={onPauseToggle} onReset={onReset} onDelete={onDelete} onDeletionPreview={onDeletionPreview} onDelegateToggle={onDelegateToggle} />
        </section>
      </div>
    </div>;
  },
);
