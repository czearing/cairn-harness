import type { Agent, ModelSettings } from "@/lib/types";

export interface AgentWorkspaceProps {
  agent: Agent;
  settings?: ModelSettings;
  settingsError?: string;
  color: string;
  avatar?: string;
  onBack: () => Promise<void>;
  onConversation: () => void;
  onColor: (color: string) => void;
  onAvatar: (avatar?: string) => void;
  onSaveDetails: (values: { title: string; description: string }) => Promise<void>;
  onSaveInstructions: (values: { prompt: string }) => Promise<void>;
  onSaveModel: (model?: string) => Promise<void>;
  onRetryModels: () => Promise<unknown>;
  onMakeLeader: () => Promise<void>;
  onPauseToggle: () => Promise<void>;
  onReset: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export interface AgentWorkspaceHandle {
  requestClose: () => Promise<boolean>;
}
