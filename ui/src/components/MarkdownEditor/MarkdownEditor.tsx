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
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import type { EditorState } from "lexical";
import { EditorToolbar } from "./EditorToolbar";
import styles from "./MarkdownEditor.module.css";

interface Props { initialMarkdown: string; onChange: (markdown: string) => void; label?: string; placeholder?: string; autoFocus?: boolean; }

export function MarkdownEditor({ initialMarkdown, onChange, label = "Markdown document", placeholder = "Start writing...", autoFocus = false }: Props) {
  return (
    <LexicalComposer initialConfig={{
      namespace: "HarnessMarkdownEditor",
      theme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode],
      onError: (cause) => { throw cause; },
      editorState: () => $convertFromMarkdownString(initialMarkdown, TRANSFORMERS),
    }}>
      <div className={styles.page}>
        <EditorToolbar />
        <RichTextPlugin
          contentEditable={<ContentEditable className={styles.editor} aria-label={label} />}
          placeholder={<div className={styles.placeholder}>{placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        {autoFocus && <AutoFocusPlugin />}
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin onChange={(state) => onChange(toMarkdown(state))} ignoreSelectionChange />
      </div>
    </LexicalComposer>
  );
}

function toMarkdown(state: EditorState) {
  let markdown = "";
  state.read(() => { markdown = $convertToMarkdownString(TRANSFORMERS); });
  return markdown;
}

const theme = {
  heading: { h1: "md-h1", h2: "md-h2", h3: "md-h3" },
  list: { ul: "md-ul", ol: "md-ol", listitem: "md-li", checklist: "md-checklist", listitemChecked: "md-checked", listitemUnchecked: "md-unchecked" },
  quote: "md-quote",
  text: { bold: "md-bold", italic: "md-italic", code: "md-code" },
  code: "md-codeblock",
};
