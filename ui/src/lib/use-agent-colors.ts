import { useStoredRecord } from "./use-stored-record";

export function useAgentColors() {
  return useStoredRecord("harness-agent-colors");
}
