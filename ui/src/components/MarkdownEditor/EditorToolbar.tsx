"use client";

import { Bold, Braces, CheckSquare, Heading2, Italic, List } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_CHECK_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { $createHeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND } from "lexical";
import styles from "./MarkdownEditor.module.css";

export function EditorToolbar() {
  const [editor] = useLexicalComposerContext();
  function heading() {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createHeadingNode("h2"));
    });
  }
  return (
    <div className={styles.toolbar} aria-label="Text formatting">
      <button aria-label="Heading" onClick={heading}><Heading2 size={15} /></button>
      <button aria-label="Bold" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}><Bold size={15} /></button>
      <button aria-label="Italic" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}><Italic size={15} /></button>
      <button aria-label="Inline code" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}><Braces size={15} /></button>
      <button aria-label="Bulleted list" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}><List size={15} /></button>
      <button aria-label="Checklist" onClick={() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)}><CheckSquare size={15} /></button>
    </div>
  );
}
