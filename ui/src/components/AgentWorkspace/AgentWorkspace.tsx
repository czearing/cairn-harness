"use client";

import { Button } from "@/components/Button/Button";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { StatusIndicator } from "../StatusIndicator/StatusIndicator";
import { SourceAgentWorkspace, type SourceAgentWorkspaceHandle } from "./SourceAgentWorkspace";
import type { AgentWorkspaceHandle, AgentWorkspaceProps } from "./agent-workspace-types";
import styles from "./AgentWorkspace.module.css";

export const AgentWorkspace = forwardRef<AgentWorkspaceHandle, AgentWorkspaceProps>(
  function AgentWorkspace({ agent, onBack, onConversation, ...props }, ref) {
    const sourceRef = useRef<SourceAgentWorkspaceHandle>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const workspace = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
      const frame = requestAnimationFrame(() => {
        workspace.current?.scrollTo({ top: 0, behavior: "auto" });
        window.scrollTo({ top: 0, behavior: "auto" });
        heading.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }, [agent.id]);
    useImperativeHandle(ref, () => ({
      requestClose: () => sourceRef.current?.requestClose() || Promise.resolve(true),
    }), []);

    return <main ref={workspace} className={styles.workspace} aria-labelledby="agent-workspace-title">
      <header className={styles.header}>
        <Button variant="ghost" className={styles.back} type="button" onClick={() => void onBack()}>
          <ArrowLeft size={16} aria-hidden="true" />Back to agents
        </Button>
        <div className={styles.identity}>
          <div>
            <span className={styles.sourceBadge}>{[
              agent.isLeader && "Project lead",
              agent.isIdeaAgent && "Idea agent",
            ].filter(Boolean).join(" · ") || "Agent"}</span>
            <h1 id="agent-workspace-title" ref={heading} tabIndex={-1}>{agent.title || agent.id}</h1>
            <p>{agent.role}</p>
          </div>
          <StatusIndicator status={agent.status} />
        </div>
        <Button variant="primary" className={styles.conversation} type="button" onClick={onConversation}>
          <MessageSquare size={15} aria-hidden="true" />Open conversation
        </Button>
      </header>
      <SourceAgentWorkspace ref={sourceRef} agent={agent} {...props} />
    </main>;
  },
);
