import { getProjects } from "@/server/projects";
import { subscribeToProjectEvents } from "@/server/project-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = () => controller.enqueue(encoder.encode("data: update\n\n"));
      const unsubscribe = subscribeToProjectEvents(getProjects(), send);
      request.signal.addEventListener("abort", unsubscribe, { once: true });
      controller.enqueue(encoder.encode("data: ready\n\n"));
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
