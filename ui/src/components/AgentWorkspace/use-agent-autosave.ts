"use client";

import { useEffect, useRef, useState } from "react";

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function useAgentAutosave<T>(
  initial: T,
  save: (value: T) => Promise<void>,
  validate: (value: T) => string,
) {
  const value = useRef(initial);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const active = useRef<Promise<boolean> | undefined>(undefined);
  const saveRef = useRef(save);
  const validateRef = useRef(validate);
  const [state, setState] = useState<AutosaveState>("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    saveRef.current = save;
    validateRef.current = validate;
  }, [save, validate]);

  async function flush(showValidation = true): Promise<boolean> {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
    const validation = validateRef.current(value.current);
    if (validation) {
      if (showValidation) {
        setError(validation);
        setState("error");
      }
      return false;
    }
    if (active.current) await active.current;
    if (savedRevision.current >= revision.current) return true;
    const targetRevision = revision.current;
    const targetValue = value.current;
    setState("saving");
    setError("");
    const operation = saveRef.current(targetValue).then(() => {
      savedRevision.current = Math.max(savedRevision.current, targetRevision);
      if (targetRevision === revision.current) setState("saved");
      return true;
    }).catch((cause) => {
      if (targetRevision === revision.current) {
        setError(cause instanceof Error ? cause.message : "Changes could not be saved.");
        setState("error");
      }
      return false;
    }).finally(() => {
      if (active.current === operation) active.current = undefined;
    });
    active.current = operation;
    const succeeded = await operation;
    if (savedRevision.current < revision.current && targetRevision < revision.current) {
      return flush(showValidation);
    }
    return succeeded;
  }

  function change(next: T, delay = 700) {
    value.current = next;
    revision.current += 1;
    setState("dirty");
    setError("");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(false), delay);
  }

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return { change, flush, state, error };
}

export function autosaveLabel(state: AutosaveState) {
  if (state === "dirty") return "Unsaved changes";
  if (state === "saving") return "Saving changes";
  if (state === "saved") return "All changes saved";
  if (state === "error") return "Changes not saved";
  return "Changes save automatically";
}
