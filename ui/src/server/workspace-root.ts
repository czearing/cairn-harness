import os from "node:os";
import path from "node:path";

export function workspaceRoot() {
  return process.env.HARNESS_WORKSPACE_ROOT || path.join(os.homedir(), "Cairn Workspaces");
}
