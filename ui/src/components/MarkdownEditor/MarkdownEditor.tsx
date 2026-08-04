"use client";

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from "@lexical/react/LexicalAutoLinkPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { $getRoot, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND, type EditorState } from "lexical";
import { useEffect, useRef } from "react";
import { EditorToolbar } from "./EditorToolbar";
import { isSafeUrl } from "./link-utils";
import styles from "./MarkdownEditor.module.css";

interface Props { initialMarkdown: string; onChange: (markdown: string) => void; onSubmit?: () => void; canSubmit?: boolean; label?: string; placeholder?: string; autoFocus?: boolean; keyboardFocus?: boolean; layout?: "document" | "workspace"; onPointerFocus?: () => void; resetKey?: string; }

const resetTag = "harness-markdown-reset";

export function MarkdownEditor({ initialMarkdown, onChange, onSubmit, canSubmit = false, label = "Markdown document", placeholder = "Start writing...", autoFocus = false, keyboardFocus = false, layout = "document", onPointerFocus, resetKey }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (keyboardFocus) surface.current?.setAttribute("data-keyboard-focus", "");
    else surface.current?.removeAttribute("data-keyboard-focus");
  }, [keyboardFocus]);
  return (
    <LexicalComposer initialConfig={{
      namespace: "HarnessMarkdownEditor",
      theme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
      onError: (cause) => { throw cause; },
      editorState: () => $convertFromMarkdownString(initialMarkdown, TRANSFORMERS),
    }}>
      <div
        ref={surface}
        className={styles.page}
        data-editor-layout={layout}
        data-keyboard-focus={keyboardFocus || undefined}
        onKeyDownCapture={() => surface.current?.setAttribute("data-keyboard-focus", "")}
        onPointerDown={() => {
          surface.current?.removeAttribute("data-keyboard-focus");
          onPointerFocus?.();
        }}
      >
        <EditorToolbar />
        <RichTextPlugin
          contentEditable={<ContentEditable
            className={styles.editor}
            aria-label={label}
            aria-keyshortcuts={onSubmit ? "Control+Enter Meta+Enter" : undefined}
          />}
          placeholder={<div className={styles.placeholder}>{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin validateUrl={isSafeUrl} attributes={{ rel: "noreferrer" }} />
        <AutoLinkPlugin matchers={linkMatchers} />
        {autoFocus && <AutoFocusPlugin />}
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <EditorResetPlugin markdown={initialMarkdown} resetKey={resetKey} />
        {onSubmit && <EditorSubmitPlugin canSubmit={canSubmit} onSubmit={onSubmit} />}
        <OnChangePlugin onChange={(state, _editor, tags) => {
          if (!tags.has(resetTag)) onChange(toMarkdown(state));
        }} ignoreSelectionChange />
      </div>
    </LexicalComposer>
  );
}

function EditorResetPlugin({ markdown, resetKey }: { markdown: string; resetKey?: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!resetKey) return;
    editor.update(() => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    }, { tag: resetTag });
    editor.focus();
  }, [editor, markdown, resetKey]);
  return null;
}

function EditorSubmitPlugin({ canSubmit, onSubmit }: { canSubmit: boolean; onSubmit: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
    if (
      !event
      || event.defaultPrevented
      || event.isComposing
      || event.keyCode === 229
      || !(event.ctrlKey || event.metaKey)
      || event.shiftKey
      || event.altKey
      || hasOpenPopup()
    ) {
      return false;
    }
    event.preventDefault();
    if (event.repeat) return true;
    if (!canSubmit) return true;
    onSubmit();
    return true;
  }, COMMAND_PRIORITY_HIGH), [canSubmit, editor, onSubmit]);
  return null;
}

function hasOpenPopup() {
  return Boolean(document.querySelector('[role="menu"]:not([hidden]), [role="listbox"]:not([hidden])'));
}

function toMarkdown(state: EditorState) {
  let markdown = "";
  state.read(() => { markdown = $convertToMarkdownString(TRANSFORMERS); });
  return markdown;
}

const theme = {
  heading: { h1: "md-h1", h2: "md-h2", h3: "md-h3", h4: "md-h4", h5: "md-h5", h6: "md-h6" },
  list: { ul: "md-ul", ol: "md-ol", listitem: "md-li", checklist: "md-checklist", listitemChecked: "md-checked", listitemUnchecked: "md-unchecked" },
  quote: "md-quote",
  text: { bold: "md-bold", italic: "md-italic", strikethrough: "md-strikethrough", code: "md-code", highlight: "md-highlight" },
  link: "md-link",
  code: "md-codeblock",
};

const urlMatcher = /(?:https?:\/\/|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,12}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/i;
const linkMatchers = [createLinkMatcherWithRegExp(urlMatcher, (value) => value.startsWith("www.") ? `https://${value}` : value)];
