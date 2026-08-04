import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { ChatPanel } from "./ChatPanel";

const meta = { component: ChatPanel, title: "Agents/ChatPanel", decorators: [(Story) => <main style={{ width: "min(430px, 100%)", height: 720 }}><Story /></main>] } satisfies Meta<typeof ChatPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const History: Story = { args: {
  projectId: "story-project",
  agent: { id: "writer", role: "Story writer", status: "working", topic: "draft", updatedAt: "" },
  messages: [
    { id: "1", sender: "concept", recipient: "writer", body: "Write from this concept.", status: "completed", timestamp: new Date().toISOString(), direction: "incoming", kind: "message" },
    { id: "2", sender: "writer", recipient: "team", body: "Draft complete.", status: "completed", timestamp: new Date().toISOString(), direction: "outgoing", kind: "assistant" },
  ],
  olderCount: 0,
  onConfigure: () => undefined,
  onSend: async () => undefined,
} };
export const LongMarkdown: Story = { args: {
  ...History.args,
  agent: { ...History.args.agent!, status: "idle" },
  messages: [
    {
      id: "long",
      sender: "writer",
      recipient: "team",
      body: `## Draft review

The opening establishes the stakes, but the middle needs a clearer causal link between the failed launch and the team's decision to change direction. This paragraph is intentionally long enough to demonstrate the readable measure and line spacing used for agent prose.

- Keep the customer impact concrete.
- Separate verified facts from assumptions.
- End with the next decision, not a generic summary.`,
      status: "completed",
      timestamp: "2026-07-15T16:10:00.000Z",
      direction: "outgoing",
      kind: "assistant",
    },
  ],
} };
export const GroupedTools: Story = { args: {
  ...History.args,
  agent: { ...History.args.agent!, status: "idle" },
  messages: [
    { id: "tool-1", sender: "writer", recipient: "cairn-harness-search", body: "Found three matching files.", status: "recorded", timestamp: "2026-07-15T16:11:00.000Z", direction: "outgoing", kind: "tool", title: "Used search" },
    { id: "tool-2", sender: "writer", recipient: "cairn-harness-update", body: "Permission denied while updating the record.", status: "failed", timestamp: "2026-07-15T16:12:00.000Z", direction: "outgoing", kind: "tool", title: "Used update" },
  ],
} };
export const LiveResponse: Story = { args: {
  ...History.args,
  messages: [
    {
      id: "request",
      sender: "dashboard",
      recipient: "writer",
      body: "Explain what you found.",
      status: "claimed",
      timestamp: "2026-07-15T16:10:00.000Z",
      direction: "incoming",
      kind: "message",
      deliveryState: "working",
    },
    {
      id: "live:writer:session-one",
      sender: "writer",
      recipient: "team",
      body: "I traced the delay to the response boundary. The agent text is now arriving while the turn is still running",
      status: "streaming",
      timestamp: "2026-07-15T16:10:08.000Z",
      direction: "outgoing",
      kind: "assistant",
      title: "Live response",
      live: true,
    },
  ],
} };
export const StreamingScrollStability: Story = {
  args: History.args,
  render: () => <StreamingDemo />,
};
export const SendThenStreamFollow: Story = {
  args: History.args,
  render: () => <SendThenStreamDemo />,
};
export const FocusedResult: Story = { args: {
  ...History.args,
  focusId: "result",
  messages: [
    ...History.args.messages!,
    { id: "result", sender: "writer", recipient: "team", body: "Focused result with surrounding conversation context.", status: "completed", timestamp: "2026-07-15T16:13:00.000Z", direction: "outgoing", kind: "turn", title: "Completed turn" },
  ],
  onReturnLatest: () => undefined,
} };
export const Empty: Story = { args: { ...History.args, agent: { ...History.args.agent!, status: "idle" }, messages: [] } };
export const InitialHistoryError: Story = { args: { ...History.args, messages: [], historyError: "Could not load conversation", onRetryHistory: () => undefined } };
export const StaleHistoryError: Story = { args: { ...History.args, historyError: "Could not load conversation", onRetryHistory: () => undefined } };

function StreamingDemo() {
  const [parts, setParts] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setParts((value) => Math.min(value + 1, 12)), 250);
    return () => window.clearInterval(timer);
  }, []);
  const timestamp = "2026-07-15T16:10:00.000Z";
  const history: ChatMessage[] = Array.from({ length: 28 }, (_, index) => ({
    id: `history-${index}`,
    sender: index % 2 ? "writer" : "dashboard",
    recipient: index % 2 ? "team" : "writer",
    body: `Conversation message ${index + 1}. This establishes enough history to verify that streaming below the viewport does not move the reader.`,
    status: "completed",
    timestamp,
    direction: (index % 2 ? "outgoing" : "incoming") as "outgoing" | "incoming",
    kind: (index % 2 ? "assistant" : "message") as "assistant" | "message",
  }));
  const body = Array.from({ length: parts }, (_, index) => `Streamed sentence ${index + 1}.`).join(" ");
  return <ChatPanel
    projectId="story-project"
    agent={{ id: "writer", role: "Story writer", status: "working", topic: "dashboard-message", updatedAt: timestamp }}
    messages={[...history, {
      id: "live:writer:session-one", sender: "writer", recipient: "team", body,
      status: "streaming", timestamp, direction: "outgoing", kind: "assistant", title: "Live response", live: true,
    }]}
    olderCount={0}
    onSend={async () => undefined}
  />;
}

function SendThenStreamDemo() {
  const timestamp = "2026-07-15T16:10:00.000Z";
  const history: ChatMessage[] = Array.from({ length: 28 }, (_, index) => ({
    id: `send-history-${index}`,
    sender: index % 2 ? "writer" : "dashboard",
    recipient: index % 2 ? "team" : "writer",
    body: `Conversation message ${index + 1}. This history makes send and streaming updates change the scroll geometry.`,
    status: "completed",
    timestamp,
    direction: (index % 2 ? "outgoing" : "incoming") as "outgoing" | "incoming",
    kind: (index % 2 ? "assistant" : "message") as "assistant" | "message",
  }));
  const [messages, setMessages] = useState(history);
  const [working, setWorking] = useState(false);
  async function send(body: string, submissionId: string) {
    setWorking(true);
    setMessages((current) => [...current, {
      id: `task:dashboard-message-${submissionId}`,
      sender: "dashboard",
      recipient: "writer",
      body,
      status: "claimed",
      timestamp: new Date().toISOString(),
      direction: "incoming",
      kind: "message",
      deliveryState: "working",
    }]);
    let parts = 0;
    const timer = window.setInterval(() => {
      parts += 1;
      const response = Array.from({ length: parts }, (_, index) => `Response segment ${index + 1}.`).join(" ");
      setMessages((current) => [...current.filter((message) => !message.live), {
        id: "live:writer:send-follow",
        sender: "writer",
        recipient: "team",
        body: response,
        status: "streaming",
        timestamp: new Date().toISOString(),
        direction: "outgoing",
        kind: "assistant",
        title: "Live response",
        live: true,
      }]);
      if (parts === 16) {
        window.clearInterval(timer);
        setWorking(false);
      }
    }, 100);
  }
  return <ChatPanel
    projectId="story-project"
    agent={{ id: "writer", role: "Story writer", status: working ? "working" : "idle", topic: "dashboard-message", updatedAt: timestamp }}
    messages={messages}
    olderCount={0}
    onSend={send}
  />;
}
