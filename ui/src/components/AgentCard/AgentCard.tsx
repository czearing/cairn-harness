"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Crown, MoreHorizontal, Sparkles } from "lucide-react";
import type { Agent } from "@/lib/types";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./AgentCard.module.css";

interface Props { agent: Agent; color?: string; avatar?: string; onClick?: () => void; onAppearance?: () => void; onPrompt?: () => void; }

export function AgentCard({ agent, color, avatar, onClick, onAppearance, onPrompt }: Props) {
  const [menu, setMenu] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    function close(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && menuRoot.current?.contains(event.target as Node)) return;
      setMenu(false);
      if (event instanceof KeyboardEvent) menuButton.current?.focus();
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  const identity = { "--agent-color": color } as CSSProperties;
  const distinctRole = normalize(agent.role) !== normalize(agent.id);
  return (
    <article style={identity} className={styles.card}>
      <button className={styles.hit} onClick={onClick} aria-label={`Open conversation with ${agent.id}`} />
      <div className={styles.top}>
        <span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>
          {!avatar && agent.id.slice(0, 2).toUpperCase()}
          {agent.isLeader && <Crown className={styles.crown} size={11} aria-label="Project leader" />}
          {agent.isProducer && <Sparkles className={styles.producer} size={11} aria-label="Work producer" />}
        </span>
        <div ref={menuRoot} className={styles.controls}><StatusPill status={agent.status} /><button ref={menuButton} className={styles.more} aria-label={`More options for ${agent.id}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={15} /></button>
        {menu && <div className={styles.menu} role="menu">
          <button role="menuitem" onClick={() => { setMenu(false); onAppearance?.(); }}>Appearance</button>
          <button role="menuitem" onClick={() => { setMenu(false); onPrompt?.(); }}>Edit prompt</button>
        </div>}</div>
      </div>
      <div className={styles.identity}><h3>{agent.id}</h3>{distinctRole && <p>{agent.role}</p>}</div>
      <div className={styles.footer}><span>{agent.lastMessage || agent.topic || "No messages yet"}</span><time>{shortTime(agent.lastMessageAt)}</time></div>
    </article>
  );
}

function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function shortTime(value?: string) {
  return value ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
}
