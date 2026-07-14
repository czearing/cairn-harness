import { Dashboard } from "@/components/Dashboard/Dashboard";
import { getProjects } from "@/server/projects";
import { workspaceRoot } from "@/server/workspace-root";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Dashboard initialProjects={getProjects()} workspaceRoot={workspaceRoot()} />;
}
