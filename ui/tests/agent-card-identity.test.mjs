import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../src/components/AgentCard/AgentCard.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../src/components/AgentCard/AgentCardSurface.tsx", import.meta.url), "utf8");
const projectView = readFileSync(new URL("../src/components/ProjectView/ProjectView.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/components/Dashboard/Dashboard.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/components/AgentWorkspace/SourceAgentWorkspace.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/projects/[projectId]/agents/[agentId]/route.ts", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/server/mutations.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/components/AgentCard/AgentCard.module.css", import.meta.url), "utf8");
const dashboardStyles = readFileSync(new URL("../src/components/Dashboard/Dashboard.module.css", import.meta.url), "utf8");

test("overview renders one standalone card grid without clone hierarchy", () => {
  assert.match(projectView, /className=\{styles\.agentGrid\}/);
  assert.match(projectView, /\.filter\(\(agent\) => agent\.kind !== "local"\)/);
  assert.doesNotMatch(projectView, /AgentFamily|AgentInstanceRow|AgentRoster|Managed copies/);
  assert.match(dashboardStyles, /\.agentGrid \{/);
  assert.match(dashboardStyles, /\.agentGrid \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*justify-content: center;/);
  assert.match(dashboardStyles, /\.agentGrid > \* \{[^}]*flex: 1 1 260px;[^}]*max-width: 320px;/);
  assert.match(dashboardStyles, /@media \(max-width: 720px\)[\s\S]*\.agentGrid > \* \{[^}]*flex-basis: 100%;[^}]*max-width: none;/);
});

test("agent cards keep only identity, status, conversation, and settings", () => {
  assert.match(component, /<AgentCardSurface/);
  assert.match(surface, /<StatusIndicator status=\{status\} size="compact"/);
  assert.match(surface, /className=\{styles\.hit\}/);
  assert.match(surface, /data-agent-configure-id/);
  assert.doesNotMatch(surface, /openAction|>Open conversation<|ArrowRight|ArrowUpRight/);
  assert.doesNotMatch(surface, /activeCount|description|eyebrow|titleMeta|agentKind|copy/);
  assert.doesNotMatch(component, /Source role|activeCount|workBody|summarizeAgentAssignments/);
});

test("clone creation entry points and mutations are removed", () => {
  assert.doesNotMatch(workspace, /CapacitySection|managed local copies|Total instances/);
  assert.doesNotMatch(dashboard, /onSaveQuantity|quantity/);
  assert.match(route, /Agent cloning is no longer supported/);
  assert.doesNotMatch(mutations, /export function updateAgentQuantity/);
});

test("standalone cards use bounded responsive geometry", () => {
  assert.match(styles, /min-height: 94px/);
  assert.match(styles, /\.card \{[^}]*display: grid;[^}]*align-items: center;/);
  assert.match(styles, /\.hit \{ position: absolute; inset: 0/);
  assert.match(styles, /container: agent-card \/ inline-size/);
  assert.match(styles, /@container agent-card \(max-width: 280px\)/);
  assert.doesNotMatch(styles, /linear-gradient|filter: blur|font-geist-mono/);
  assert.doesNotMatch(styles, /data-agent-variant="copy"/);
});
