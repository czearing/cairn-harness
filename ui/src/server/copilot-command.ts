import { existsSync } from "node:fs";
import path from "node:path";

export interface CopilotInvocation {
  command: string;
  args: string[];
}

export function copilotInvocation(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  nodeExecutable = process.execPath,
): CopilotInvocation {
  const configured = environment.HARNESS_COPILOT_BIN?.trim();
  const executable = configured || resolveFromPath("copilot", environment, platform) || "copilot";
  if (platform !== "win32") return { command: executable, args: [] };

  const directory = path.dirname(executable);
  const loader = path.join(directory, "node_modules", "@github", "copilot", "npm-loader.js");
  if (isCopilotLauncher(executable) && existsSync(loader)) {
    const bundledNode = path.join(directory, "node.exe");
    return { command: existsSync(bundledNode) ? bundledNode : nodeExecutable, args: [loader] };
  }
  if (path.extname(executable).toLowerCase() === ".ps1") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable],
    };
  }
  return { command: executable, args: [] };
}

function resolveFromPath(name: string, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const value = environment.PATH || environment.Path;
  if (!value) return undefined;
  const suffixes = platform === "win32"
    ? ["", ...(environment.PATHEXT || ".COM;.EXE;.BAT;.CMD;.PS1").split(";")]
    : [""];
  for (const directory of value.split(path.delimiter)) {
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${name}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function isCopilotLauncher(executable: string) {
  return ["copilot", "copilot.cmd", "copilot.ps1"].includes(path.basename(executable).toLowerCase());
}
