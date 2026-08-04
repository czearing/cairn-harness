import type { SafeActivity } from "@/lib/types";

interface ToolProjection {
  title: string;
  body: string;
  status: string;
  activity: SafeActivity;
}

export function projectToolActivity(name: string, arguments_: unknown, complete: boolean, success = true): ToolProjection {
  const tool = toolLabel(name);
  const detail = safeDetail(name, arguments_);
  const phase = complete ? (success ? "Completed" : "Failed") : "Working";
  return {
    title: `${complete ? "Used" : "Using"} ${tool}`,
    body: detail || `${phase} ${tool}`,
    status: complete ? (success ? "recorded" : "failed") : "working",
    activity: { phase, tool, ...activityDetail(name, arguments_) },
  };
}

function safeDetail(name: string, value: unknown) {
  if (isSql(name)) return sqlDescription(value);
  const activity = activityDetail(name, value);
  if (activity.command) return `Command: ${activity.command}`;
  if (activity.target) return `Target: ${activity.target}`;
  return "";
}

function activityDetail(name: string, value: unknown): Pick<SafeActivity, "target" | "command"> {
  const record = asRecord(value);
  if (isSql(name)) return { target: sqlDescription(value) };
  if (/powershell|shell|command/i.test(name)) {
    return { command: redact(limit(String(record.command || record.description || ""), 240)) };
  }
  const target = record.path || record.file || record.paths || record.pattern || record.query || record.url || record.task;
  if (target) return { target: redact(limit(formatTarget(target), 240)) };
  const patch = String(record.patch || record.input || "");
  const files = [...patch.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)/g)].map((match) => match[1]);
  return files.length ? { target: limit(files.join(", "), 240) } : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatTarget(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(", ") : String(value);
}

function redact(value: string) {
  const tokens = tokenize(value);
  let redactNext = false;
  return tokens.map((token) => {
    if (redactNext) {
      redactNext = false;
      return "[redacted]";
    }
    const assignment = /^([^=:]*(?:token|secret|password|api[_-]?key|credential)[^=:]*)([=:])(.*)$/i.exec(token);
    if (assignment) return `${assignment[1]}${assignment[2]}[redacted]`;
    if (/^-{0,2}(?:[\w-]*(?:token|secret|password|api[_-]?key|credential)[\w-]*)$/i.test(token)) {
      redactNext = true;
      return token;
    }
    if (/^Bearer$/i.test(token)) {
      redactNext = true;
      return token;
    }
    return redactAuthorization(token);
  }).join(" ");
}

function tokenize(value: string) {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && quote && index + 1 < value.length) {
      token += character + value[++index];
    } else if (character === quote) {
      token += character;
      quote = "";
    } else if (!quote && (character === "'" || character === '"')) {
      token += character;
      quote = character;
    } else if (!quote && /\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function redactAuthorization(token: string) {
  if (!/authorization\s*:/i.test(token)) {
    return token.replace(/(Bearer\s+)[^"'\s]+/gi, "$1[redacted]");
  }
  if (/\*{3,}|\[redacted\]/i.test(token)) return token;
  const quote = /^(['"])/.exec(token)?.[1] || "";
  const suffix = quote && token.endsWith(quote) ? quote : "";
  const prefix = token.match(/^(.*?authorization\s*:\s*)(?:Bearer\s+)?/i)?.[1] || "";
  const scheme = /\bauthorization\s*:\s*Bearer\b/i.test(token) ? "Bearer " : "";
  return `${prefix}${scheme}[redacted]${suffix}`;
}

function limit(value: string, maximum: number) {
  return value.length > maximum ? `${value.slice(0, maximum - 3)}...` : value;
}

function toolLabel(name: string) {
  if (isSql(name)) return "Planning";
  const cleaned = name
    .replace(/^(functions|cairn-harness|cairnlearn|cairn|github-mcp-server)[-_.]/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : "Tool";
}

function isSql(name: string) {
  return /(?:^|[._/-])sql$/i.test(name);
}

function sqlDescription(value: unknown) {
  const description = String(asRecord(value).description || "").trim();
  return limit(description || "Updated structured task state", 120);
}
