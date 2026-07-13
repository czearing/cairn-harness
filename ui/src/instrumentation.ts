export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAllProjects } = await import("@/server/supervisor");
  startAllProjects();
}
