import { Dashboard } from "@/components/Dashboard/Dashboard";
import { getProjects } from "@/server/projects";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Dashboard initialProjects={getProjects()} />;
}
