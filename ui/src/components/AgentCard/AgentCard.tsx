"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Crown, MoreHorizontal, Sparkles } from "lucide-react";
import type { Agent } from "@/lib/types";
import { StatusPill } from "../StatusPill/StatusPill";
import styles from "./AgentCard.module.css";

interface Props { agent: Agent; color?: string; avatar?: string; onClick?: () => void; onPrefetch?: () => void; onAppearance?: () => void; onPrompt?: () => void; onClearContext?: () => void; onDelete?: () => void; }

export function AgentCard({ agent, color, avatar, onClick, onPrefetch, onAppearance, onPrompt, onClearContext, onDelete }: Props) {
  const [menu, setMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menu) menuRoot.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    function close(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && menuRoot.current?.contains(event.target as Node)) return;
      setMenu(false);
      setConfirmClear(false);
      setConfirmDelete(false);
      if (event instanceof KeyboardEvent) menuButton.current?.focus();
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      const menuElement = event.currentTarget;
      const focusable = [...document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
        .filter((item) => !menuElement.contains(item));
      const triggerIndex = focusable.indexOf(menuButton.current as HTMLElement);
      focusable[triggerIndex + (event.shiftKey ? -1 : 1)]?.focus();
      setMenu(false);
      event.preventDefault();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(menuRoot.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") || [])];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    items[(current + offset + items.length) % items.length]?.focus();
    event.preventDefault();
  }
  const identity = { "--agent-color": color } as CSSProperties;
  const distinctRole = normalize(agent.role) !== normalize(agent.id);
  return (
    <article style={identity} className={styles.card}>
      <button className={styles.hit} onPointerEnter={onPrefetch} onPointerDown={onPrefetch} onClick={onClick} aria-label={`Open conversation with ${agent.id}`} />
      <div className={styles.top}>
        <span className={styles.avatar} style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}>
          {!avatar && agent.id.slice(0, 2).toUpperCase()}
          {agent.isLeader && <Crown className={styles.crown} size={11} aria-label="Project leader" />}
          {agent.isProducer && <Sparkles className={styles.producer} size={11} aria-label="Work producer" />}
        </span>
        <div ref={menuRoot} className={styles.controls}><StatusPill status={agent.status} /><button ref={menuButton} className={styles.more} aria-label={`More options for ${agent.id}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => { setConfirmClear(false); setConfirmDelete(false); setMenu(!menu); }}><MoreHorizontal size={15} /></button>
        {menu && <div className={styles.menu} role="menu" onKeyDown={moveMenuFocus}>
          <button role="menuitem" onClick={() => { setMenu(false); onAppearance?.(); }}>Appearance</button>
          <button role="menuitem" onClick={() => { setMenu(false); onPrompt?.(); }}>Edit prompt</button>
          {!confirmClear
            ? <button role="menuitem" onClick={() => setConfirmClear(true)}>Clear context</button>
            : <button role="menuitem" onClick={() => { setMenu(false); onClearContext?.(); }}>Confirm clear context</button>}
          {!agent.isLeader && (!confirmDelete
            ? <button role="menuitem" className={styles.danger} onClick={() => setConfirmDelete(true)}>Delete agent</button>
            : <button role="menuitem" className={styles.danger} onClick={() => { setMenu(false); onDelete?.(); }}>Confirm delete agent</button>)}
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
