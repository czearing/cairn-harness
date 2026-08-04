export function projectRemovalCopy(project: { id: string; name: string }) {
  return {
    menuItem: "Remove project…",
    heading: `Remove ${project.name}?`,
    explanation: "Agents will stop and Harness will permanently delete this project's task history, agent sessions, Cairn memory, and project-specific skills. Repository files remain on disk.",
    action: "Remove project",
    pending: "Removing project",
  };
}
