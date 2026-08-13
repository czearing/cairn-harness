import { createEventStream } from "@/server/event-stream";
import { getProjects } from "@/server/projects";
import { subscribeToProjectEvents } from "@/server/project-events";
import { subscribeToProjectRegistry } from "@/server/project-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const stream = createEventStream({
    signal: request.signal,
    start(send) {
      const sendControl = (status: "ready" | "degraded") => send(`data: ${status}\n\n`);
      const subscribe = () => {
        sendControl("ready");
        return subscribeToProjectEvents(
          getProjects(),
          (event) => send(`data: ${JSON.stringify(event)}\n\n`),
          () => sendControl("degraded"),
        );
      };
      let unsubscribeProjects = subscribe();
      const unsubscribeRegistry = subscribeToProjectRegistry(() => {
        unsubscribeProjects = subscribe();
      });
      return () => {
        unsubscribeRegistry();
        unsubscribeProjects();
      };
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
