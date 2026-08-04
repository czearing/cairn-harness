"use client";

import { Button } from "@/components/Button/Button";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronDown,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type LexicalNode,
} from "lexical";
import { isSafeUrl, normalizeUrl } from "./link-utils";
import styles from "./MarkdownEditor.module.css";

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";
type ListType = "bullet" | "number" | "check" | undefined;

interface ToolbarState {
  block: BlockType;
  list: ListType;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  inlineCode: boolean;
  highlight: boolean;
  link: boolean;
  linkUrl: string;
  canLink: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

interface MenuItem {
  label: string;
  icon: ReactNode;
  role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

const initialState: ToolbarState = {
  block: "paragraph",
  list: undefined,
  bold: false,
  italic: false,
  strikethrough: false,
  inlineCode: false,
  highlight: false,
  link: false,
  linkUrl: "",
  canLink: false,
  canUndo: false,
  canRedo: false,
};

const blockLabels: Record<BlockType, string> = {
  paragraph: "Body",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  quote: "Quote",
  code: "Code block",
};

export function EditorToolbar() {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState(initialState);
  const [focusIndex, setFocusIndex] = useState(0);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");
  const toolbar = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateActiveState = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setActive((current) => equalToolbarState(current, initialState) ? current : initialState);
          return;
        }
        const nodes = selection.getNodes();
        const selectedNodes = nodes.length ? nodes : [selection.anchor.getNode()];
        const link = findAncestor(selection.anchor.getNode(), $isLinkNode);
        const next: ToolbarState = {
          block: getBlockType(selection.anchor.getNode()),
          list: getListType(selection.anchor.getNode()),
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          strikethrough: selection.hasFormat("strikethrough"),
          inlineCode: selection.hasFormat("code"),
          highlight: selection.hasFormat("highlight"),
          link: Boolean(link),
          linkUrl: link?.getURL() || "",
          canLink: Boolean(link) || !selection.isCollapsed(),
          canUndo: false,
          canRedo: false,
        };
        if (selectedNodes.some((node) => findAncestor(node, $isCodeNode))) next.block = "code";
        setActive((current) => {
          const complete = { ...next, canUndo: current.canUndo, canRedo: current.canRedo };
          return equalToolbarState(current, complete) ? current : complete;
        });
      });
    };
    updateActiveState();
    const unregisterUpdate = editor.registerUpdateListener(updateActiveState);
    const unregisterUndo = editor.registerCommand(CAN_UNDO_COMMAND, (canUndo) => {
      setActive((current) => current.canUndo === canUndo ? current : { ...current, canUndo });
      return false;
    }, COMMAND_PRIORITY_LOW);
    const unregisterRedo = editor.registerCommand(CAN_REDO_COMMAND, (canRedo) => {
      setActive((current) => current.canRedo === canRedo ? current : { ...current, canRedo });
      return false;
    }, COMMAND_PRIORITY_LOW);
    return () => {
      unregisterUpdate();
      unregisterUndo();
      unregisterRedo();
    };
  }, [editor]);

  function run(action: () => void) {
    action();
    requestAnimationFrame(() => editor.focus());
  }

  function setBlock(type: BlockType) {
    if (active.list) editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => {
        if (type === "paragraph") return $createParagraphNode();
        if (type === "quote") return $createQuoteNode();
        if (type === "code") return $createCodeNode();
        return $createHeadingNode(type);
      });
    });
  }

  function toggleList(type: Exclude<ListType, undefined>) {
    const command = type === "bullet"
      ? INSERT_UNORDERED_LIST_COMMAND
      : type === "number"
        ? INSERT_ORDERED_LIST_COMMAND
        : INSERT_CHECK_LIST_COMMAND;
    editor.dispatchCommand(active.list === type ? REMOVE_LIST_COMMAND : command, undefined);
  }

  function openLinkEditor() {
    if (!active.canLink) return;
    setLinkValue(active.linkUrl);
    setLinkError("");
    setLinkEditorOpen(true);
    requestAnimationFrame(() => linkInput.current?.focus());
  }

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = normalizeUrl(linkValue);
    if (!isSafeUrl(url)) {
      setLinkError("Enter a valid web, email, phone, anchor, or relative URL.");
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    setLinkEditorOpen(false);
    setLinkError("");
    requestAnimationFrame(() => editor.focus());
  }

  function removeLink() {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setLinkEditorOpen(false);
    setLinkError("");
    requestAnimationFrame(() => editor.focus());
  }

  const blockItems: MenuItem[] = [
    { label: "Body text", icon: <Pilcrow size={15} />, role: "menuitemradio", checked: active.block === "paragraph", onSelect: () => run(() => setBlock("paragraph")) },
    { label: "Heading 1", icon: <Heading1 size={15} />, role: "menuitemradio", checked: active.block === "h1", onSelect: () => run(() => setBlock("h1")) },
    { label: "Heading 2", icon: <Heading2 size={15} />, role: "menuitemradio", checked: active.block === "h2", onSelect: () => run(() => setBlock("h2")) },
    { label: "Heading 3", icon: <Heading3 size={15} />, role: "menuitemradio", checked: active.block === "h3", onSelect: () => run(() => setBlock("h3")) },
    { label: "Heading 4", icon: <Heading3 size={15} />, role: "menuitemradio", checked: active.block === "h4", onSelect: () => run(() => setBlock("h4")) },
    { label: "Heading 5", icon: <Heading3 size={15} />, role: "menuitemradio", checked: active.block === "h5", onSelect: () => run(() => setBlock("h5")) },
    { label: "Heading 6", icon: <Heading3 size={15} />, role: "menuitemradio", checked: active.block === "h6", onSelect: () => run(() => setBlock("h6")) },
    { label: "Quote", icon: <Quote size={15} />, role: "menuitemradio", checked: active.block === "quote", onSelect: () => run(() => setBlock("quote")) },
    { label: "Code block", icon: <Code2 size={15} />, role: "menuitemradio", checked: active.block === "code", onSelect: () => run(() => setBlock("code")) },
  ];
  const moreItems: MenuItem[] = [
    { label: "Numbered list", icon: <ListOrdered size={15} />, checked: active.list === "number", onSelect: () => run(() => toggleList("number")) },
    { label: "Strikethrough", icon: <Strikethrough size={15} />, checked: active.strikethrough, onSelect: () => run(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")) },
    { label: "Highlight", icon: <Highlighter size={15} />, checked: active.highlight, onSelect: () => run(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "highlight")) },
    { label: "Undo", icon: <Undo2 size={15} />, disabled: !active.canUndo, onSelect: () => run(() => editor.dispatchCommand(UNDO_COMMAND, undefined)) },
    { label: "Redo", icon: <Redo2 size={15} />, disabled: !active.canRedo, onSelect: () => run(() => editor.dispatchCommand(REDO_COMMAND, undefined)) },
  ];

  function keyDown(event: React.KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...(toolbar.current?.querySelectorAll<HTMLButtonElement>(":scope > button, :scope > div > button") || [])]
      .filter((button) => !button.disabled);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (Math.max(0, current) + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    setFocusIndex(next);
    buttons[next]?.focus();
  }

  return (
    <div ref={toolbar} className={styles.toolbar} role="toolbar" aria-label="Formatting" onKeyDown={keyDown}>
      <ToolbarMenu
        label="Text style"
        visibleLabel={blockLabels[active.block]}
        icon={<Pilcrow size={15} />}
        items={blockItems}
        tabIndex={focusIndex === 0 ? 0 : -1}
        onFocus={() => setFocusIndex(0)}
      />
      <span className={styles.separator} role="separator" aria-orientation="vertical" />
      <Button variant="ghost" size="icon" type="button" title="Bold" aria-label="Bold" aria-pressed={active.bold} tabIndex={focusIndex === 1 ? 0 : -1} onFocus={() => setFocusIndex(1)} onClick={() => run(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"))}><Bold size={15} /></Button>
      <Button variant="ghost" size="icon" type="button" title="Italic" aria-label="Italic" aria-pressed={active.italic} tabIndex={focusIndex === 2 ? 0 : -1} onFocus={() => setFocusIndex(2)} onClick={() => run(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"))}><Italic size={15} /></Button>
      <Button variant="ghost" size="icon" type="button" title="Inline code" aria-label="Inline code" aria-pressed={active.inlineCode} tabIndex={focusIndex === 3 ? 0 : -1} onFocus={() => setFocusIndex(3)} onClick={() => run(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code"))}><Braces size={15} /></Button>
      <Button variant="ghost" size="icon" type="button" title="Link" aria-label="Link" aria-pressed={active.link} disabled={!active.canLink} tabIndex={focusIndex === 4 ? 0 : -1} onFocus={() => setFocusIndex(4)} onClick={openLinkEditor}><Link2 size={15} /></Button>
      <span className={styles.separator} role="separator" aria-orientation="vertical" />
      <Button variant="ghost" size="icon" type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={active.list === "bullet"} tabIndex={focusIndex === 5 ? 0 : -1} onFocus={() => setFocusIndex(5)} onClick={() => run(() => toggleList("bullet"))}><List size={15} /></Button>
      <Button variant="ghost" size="icon" type="button" title="Checklist" aria-label="Checklist" aria-pressed={active.list === "check"} tabIndex={focusIndex === 6 ? 0 : -1} onFocus={() => setFocusIndex(6)} onClick={() => run(() => toggleList("check"))}><CheckSquare size={15} /></Button>
      <ToolbarMenu
        label="More formatting"
        icon={<MoreHorizontal size={16} />}
        items={moreItems}
        tabIndex={focusIndex === 7 ? 0 : -1}
        onFocus={() => setFocusIndex(7)}
      />
      {linkEditorOpen && <form className={styles.linkEditor} onSubmit={applyLink}>
        <label htmlFor="markdown-link-url">Link URL</label>
        <input
          ref={linkInput}
          id="markdown-link-url"
          value={linkValue}
          inputMode="url"
          placeholder="https://example.com"
          aria-invalid={linkError ? "true" : undefined}
          aria-describedby={linkError ? "markdown-link-error" : undefined}
          onChange={(event) => {
            setLinkValue(event.target.value);
            if (linkError) setLinkError("");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setLinkEditorOpen(false);
            requestAnimationFrame(() => editor.focus());
          }}
        />
        {linkError && <span id="markdown-link-error" role="alert">{linkError}</span>}
        <div>
          {active.link && <Button variant="secondary" size="compact" type="button" onClick={removeLink}>Remove</Button>}
          <Button variant="primary" size="compact" type="submit">Apply</Button>
        </div>
      </form>}
    </div>
  );
}

function ToolbarMenu({ label, visibleLabel, icon, items, tabIndex, onFocus }: {
  label: string;
  visibleLabel?: string;
  icon: ReactNode;
  items: MenuItem[];
  tabIndex: number;
  onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[role^='menuitem']:not(:disabled)")?.focus());
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && root.current?.contains(event.target as Node)) return;
      setOpen(false);
      if (event instanceof KeyboardEvent) requestAnimationFrame(() => trigger.current?.focus());
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);
  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const menuItems = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not(:disabled)") || [])];
    if (!menuItems.length) return;
    const current = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? menuItems.length - 1
        : (Math.max(0, current) + (event.key === "ArrowDown" ? 1 : -1) + menuItems.length) % menuItems.length;
    event.preventDefault();
    event.stopPropagation();
    menuItems[next]?.focus();
  }
  return <div ref={root} className={styles.toolbarMenu} onKeyDown={moveFocus}>
    <Button
      ref={trigger}
      variant="ghost"
      size={visibleLabel ? "compact" : "icon"}
      type="button"
      className={visibleLabel ? styles.blockButton : undefined}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={() => setOpen((current) => !current)}
    >
      {icon}
      {visibleLabel && <span>{visibleLabel}</span>}
      {visibleLabel && <ChevronDown size={13} aria-hidden="true" />}
    </Button>
    {open && <div className={styles.toolbarMenuPopup} role="menu" aria-label={label}>
      {items.map((item) => <Button
        key={item.label}
        variant="menu"
        type="button"
        role={item.role || (item.checked === undefined ? "menuitem" : "menuitemcheckbox")}
        aria-checked={item.checked === undefined ? undefined : item.checked}
        disabled={item.disabled}
        onClick={() => {
          item.onSelect();
          setOpen(false);
        }}
      >
        {item.icon}<span>{item.label}</span>
      </Button>)}
    </div>}
  </div>;
}

function getBlockType(node: LexicalNode): BlockType {
  const heading = findAncestor(node, $isHeadingNode);
  if (heading) return heading.getTag();
  if (findAncestor(node, $isQuoteNode)) return "quote";
  if (findAncestor(node, $isCodeNode)) return "code";
  if (findAncestor(node, $isParagraphNode)) return "paragraph";
  return "paragraph";
}

function getListType(node: LexicalNode): ListType {
  const list = findAncestor(node, $isListNode);
  const type = list?.getListType();
  return type === "bullet" || type === "number" || type === "check" ? type : undefined;
}

function findAncestor<T extends LexicalNode>(node: LexicalNode, predicate: (candidate: LexicalNode) => candidate is T): T | undefined;
function findAncestor(node: LexicalNode, predicate: (candidate: LexicalNode) => boolean): LexicalNode | undefined;
function findAncestor(node: LexicalNode, predicate: (candidate: LexicalNode) => boolean) {
  let current: LexicalNode | null = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.getParent();
  }
  return undefined;
}

function equalToolbarState(left: ToolbarState, right: ToolbarState) {
  return left.block === right.block
    && left.list === right.list
    && left.bold === right.bold
    && left.italic === right.italic
    && left.strikethrough === right.strikethrough
    && left.inlineCode === right.inlineCode
    && left.highlight === right.highlight
    && left.link === right.link
    && left.linkUrl === right.linkUrl
    && left.canLink === right.canLink
    && left.canUndo === right.canUndo
    && left.canRedo === right.canRedo;
}
