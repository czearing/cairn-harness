import { dashboardHref } from "@/lib/dashboard-route";
import { SELECTED_PROJECT_KEY } from "@/lib/selected-project";
import { getProjects } from "@/server/projects";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = getProjects();
  const cookieProject = (await cookies()).get(SELECTED_PROJECT_KEY)?.value;
  const selectedProject = projects.some((project) => project.id === cookieProject)
    ? cookieProject
    : projects[0]?.id;
  redirect(selectedProject
    ? dashboardHref({ kind: "project", projectId: selectedProject, view: "overview" })
    : dashboardHref({ kind: "new-project" }));
}
