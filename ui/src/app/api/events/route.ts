import { getProjects } from "@/server/projects";
import { subscribeToProjectEvents } from "@/server/project-events";
import { subscribeToProjectRegistry } from "@/server/project-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: { projectId: string; conversations: string[] }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const sendControl = (status: "ready" | "degraded") =>
        controller.enqueue(encoder.encode(`data: ${status}\n\n`));
      const subscribe = () => {
        sendControl("ready");
        return subscribeToProjectEvents(
          getProjects(),
          send,
          () => sendControl("degraded"),
        );
      };
      let unsubscribeProjects = subscribe();
      const unsubscribeRegistry = subscribeToProjectRegistry(() => {
        unsubscribeProjects = subscribe();
      });
      let closed = false;
      cleanup = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", cleanup);
        unsubscribeRegistry();
        unsubscribeProjects();
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
