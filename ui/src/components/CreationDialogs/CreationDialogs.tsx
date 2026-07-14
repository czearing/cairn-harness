import type { Project } from "@/lib/types";
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

export function NewAgentDialog({ open, project, onCreate, onClose }: {
  open: boolean; project?: Project; onCreate: (draft: AgentDraft) => Promise<void>; onClose: () => void;
}) {
  return <Modal title="New agent" open={open} onClose={onClose}>
    {project && <NewAgentForm first={!project.agents.length} onCancel={onClose} onCreate={onCreate} />}
  </Modal>;
}
