import type { ModelSettings, Project } from "@/lib/types";
import { AutomationForm, type ProjectWorkflowDraft } from "../AutomationForm/AutomationForm";
import { IdeaAgentsForm, type IdeaAgentsDraft } from "../IdeaAgentsForm/IdeaAgentsForm";
import { Modal } from "../Modal/Modal";
import { NewAgentForm, type AgentDraft } from "../NewAgentForm/NewAgentForm";
import { NewProjectForm, type ProjectDraft } from "../NewProjectForm/NewProjectForm";
export type { AgentDraft, ProjectDraft };

export function NewProjectDialog({ open, workspaceRoot, onBrowse, onCreate, onClose }: {
  open: boolean; workspaceRoot: string; onBrowse: (initial: string) => Promise<string | undefined>;
  onCreate: (draft: ProjectDraft) => Promise<void>; onClose: () => void;
}) {
  return <Modal title="New project" open={open} onClose={onClose}>
    <NewProjectForm workspaceRoot={workspaceRoot} onBrowse={onBrowse} onCreate={onCreate} onCancel={onClose} onComplete={onClose} />
  </Modal>;
}

export function NewAgentDialog({ open, project, settings, settingsError, onCreate, onClose }: {
  open: boolean; project?: Project; settings?: ModelSettings; settingsError?: string; onCreate: (draft: AgentDraft) => Promise<void>; onClose: () => void;
}) {
  return <Modal title="New agent" open={open} onClose={onClose}>
    {project && <NewAgentForm first={!project.agents.length} agents={project.agents} settings={settings} settingsError={settingsError} onCancel={onClose} onCreate={onCreate} />}
  </Modal>;
}

export function AutomationDialog({ open, project, onSave, onClose }: {
  open: boolean; project?: Project; onSave: (draft: ProjectWorkflowDraft) => Promise<void>; onClose: () => void;
}) {
  return <Modal title="Project workflow" open={open} onClose={onClose}>
    {project && <AutomationForm project={project} onCancel={onClose} onSave={onSave} />}
  </Modal>;
}

export function IdeaAgentsDialog({ open, project, onSave, onClose }: {
  open: boolean; project?: Project; onSave: (draft: IdeaAgentsDraft) => Promise<void>; onClose: () => void;
}) {
  return <Modal title="Idea agents" open={open} onClose={onClose}>
    {project && <IdeaAgentsForm project={project} onCancel={onClose} onSave={onSave} />}
  </Modal>;
}
