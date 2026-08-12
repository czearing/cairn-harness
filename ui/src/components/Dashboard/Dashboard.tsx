"use client";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import useSWR from "swr";
import type { Agent, HealthState, ModelSettings, Project } from "@/lib/types";
import { dashboardHref, parseDashboardPath, projectIdForRoute, type DashboardRoute } from "@/lib/dashboard-route";
import { agentColor } from "@/lib/colors";
import { agentAppearanceOverride, projectAgentColor, updateAgentAppearance } from "@/lib/agent-appearance";
import { useAgentColors } from "@/lib/use-agent-colors";
import { useStoredRecord } from "@/lib/use-stored-record";
import { useSelectedProject } from "@/lib/use-selected-project";
import { useProjectEvents } from "@/lib/use-project-events";
import { prefetchConversation } from "@/lib/use-conversation";
import type { AgentWorkspaceHandle } from "../AgentWorkspace/agent-workspace-types";
import { ActivityRail } from "../ActivityRail/ActivityRail";
import { EmptyProject } from "../EmptyProject/EmptyProject";
import type { AgentDraft, ProjectDraft } from "../CreationDialogs/CreationDialogs";
import { ProjectSidebar } from "../ProjectSidebar/ProjectSidebar";
import { ProjectView } from "../ProjectView/ProjectView";
import { browseWorkspace, fetchJson, healthy, isHealthState, isModelSettings, isProjectList } from "./dashboard-data";
import { automationWarning, postJson, putAutomation, submissionWarning, writeJson } from "./dashboard-requests";
import { ResizeHandle } from "../ResizeHandle/ResizeHandle";
import { DASHBOARD_RAILS } from "./dashboard-layout";
import { useDraftWorkspaces } from "./DraftWorkspace";
import { useCoalescedRefresh } from "./use-coalesced-refresh";
import { useDashboardLayout } from "./use-dashboard-layout";
import styles from "./Dashboard.module.css";

const ActionDrawer = dynamic(() => import("../ActionDrawer/ActionDrawer").then((module) => module.ActionDrawer), { ssr: false });
const AgentWorkspace = dynamic(() => import("../AgentWorkspace/AgentWorkspace").then((module) => module.AgentWorkspace));
const ConversationDrawer = dynamic(() => import("../ConversationDrawer/ConversationDrawer").then((module) => module.ConversationDrawer));
const IdentityEditor = dynamic(() => import("../AgentIdentityEditor/AgentIdentityEditor").then((module) => module.IdentityEditor));
const GlobalSettingsForm = dynamic(() => import("../GlobalSettings/GlobalSettings").then((module) => module.GlobalSettingsForm));
const SystemStatus = dynamic(() => import("../SystemStatus/SystemStatus").then((module) => module.SystemStatus));
const NewProjectDialog = dynamic(() => import("../CreationDialogs/CreationDialogs").then((module) => module.NewProjectDialog), { ssr: false });
const NewAgentDialog = dynamic(() => import("../CreationDialogs/CreationDialogs").then((module) => module.NewAgentDialog), { ssr: false });
const AutomationDialog = dynamic(() => import("../CreationDialogs/CreationDialogs").then((module) => module.AutomationDialog), { ssr: false });
const IdeaAgentsDialog = dynamic(() => import("../CreationDialogs/CreationDialogs").then((module) => module.IdeaAgentsDialog), { ssr: false });

const fallbackRefreshInterval = 2_000;
const routeFocusKey = "harness-route-focus";
export function Dashboard({ initialProjects, initialSelectedProject, initialDashboardLayout, initialDraftHeight, initialPathname, workspaceRoot }: { initialProjects: Project[]; initialSelectedProject?: string; initialDashboardLayout?: string; initialDraftHeight?: number; initialPathname: string; workspaceRoot: string }) {
  const pathname = usePathname() || initialPathname;
  const router = useRouter();
  const [, startRouteTransition] = useTransition();
  // Overlay routes render entirely from client state, but every dashboard page is
  // force-dynamic, so Next cannot prefetch them and each click would otherwise wait for a
  // server roundtrip. Painting the requested route immediately keeps interaction latency
  // independent of server load; the URL catches up in the background. The request is tied
  // to the pathname it was made from, so it stops applying once the router lands.
  const [requestedRoute, setRequestedRoute] = useState<{ href: string; from: string }>();
  const activePathname = requestedRoute?.from === pathname ? requestedRoute.href : pathname;
  const route = parseDashboardPath(activePathname) || { kind: "root" };
  const routeProjectId = projectIdForRoute(route);
  const { data = initialProjects, error: projectError, mutate } = useSWR<Project[]>(
    "/api/projects",
    (url: string) => fetchJson(url, "Could not refresh projects", isProjectList),
    { fallbackData: initialProjects },
  );
  const { data: health = healthy, error: healthError, mutate: mutateHealth } = useSWR<HealthState>(
    "/api/health",
    (url: string) => fetchJson(url, "Could not refresh system status", isHealthState),
    { fallbackData: healthy },
  );
  const { data: modelSettings, error: modelSettingsError, mutate: mutateModelSettings } = useSWR<ModelSettings>(
    "/api/settings",
    (url: string) => fetchJson(url, "Could not load model settings", isModelSettings),
  );
  const [selectedId, setSelectedId] = useSelectedProject(initialSelectedProject);
  const chat = route.kind === "conversation" ? route : undefined;
  const configuration = route.kind === "agent-settings" ? route : undefined;
  const workspaceView = route.kind === "project" ? route.view : "overview";
  const addingProject = route.kind === "new-project";
  const agentProjectId = route.kind === "new-agent" ? route.projectId : undefined;
  const automationProjectId = route.kind === "project-settings" && route.section === "workflow" ? route.projectId : undefined;
  const ideaProjectId = route.kind === "project-settings" && route.section === "ideas" ? route.projectId : undefined;
  const projectAppearanceId = route.kind === "project-settings" && route.section === "appearance" ? route.projectId : undefined;
  const showHealth = route.kind === "system";
  const showSettings = route.kind === "settings";
  const chatReturnFocus = useRef<HTMLElement | undefined>(undefined);
  const configurationReturnFocus = useRef<HTMLElement | undefined>(undefined);
  const pendingConfigurationFocus = useRef<string | undefined>(undefined);
  const agentConfigurationRef = useRef<AgentWorkspaceHandle>(null);
  const agentConfigurationRevision = useRef(0);
  const agentMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const [submissionWarningMessage, setSubmissionWarningMessage] = useState<string>();
  const [automationWarningMessage, setAutomationWarningMessage] = useState<string>();
  const [colors, setColors] = useAgentColors();
  const [avatars, setAvatars] = useStoredRecord("harness-agent-avatars");
  const [projectColors, setProjectColors] = useStoredRecord("harness-project-colors");
  const [projectAvatars, setProjectAvatars] = useStoredRecord("harness-project-avatars");
  const [activityCutoffs, setActivityCutoffs] = useStoredRecord("harness-activity-cutoffs");
  const {
    shellRef,
    shellStyle,
    wide: wideLayout,
    widths: dashboardWidths,
    projectNavMax,
    activityMax,
    previewRail,
    commitRail,
    cancelPreview,
  } = useDashboardLayout(initialDashboardLayout);
  const project = data.find((item) => item.id === (routeProjectId || selectedId)) || data[0];
  const chatAgent = project?.id === chat?.projectId ? project.agents.find((agent) => agent.id === chat.agentId) : undefined;
  const configurationAgent = project?.id === configuration?.projectId ? project.agents.find((agent) => agent.id === configuration.agentId) : undefined;
  useEffect(() => {
    agentConfigurationRevision.current = configurationAgent?.configurationRevision || 0;
    agentMutationQueue.current = Promise.resolve();
  }, [configurationAgent?.id, configurationAgent?.configurationRevision]);
  useEffect(() => {
    const agentId = pendingConfigurationFocus.current;
    if (configurationAgent || !agentId) return;
    const frame = requestAnimationFrame(() => {
      const id = CSS.escape(agentId);
      (configurationReturnFocus.current?.isConnected
        ? configurationReturnFocus.current
        : document.querySelector<HTMLElement>(`[data-agent-configure-id="${id}"]`)
          || document.querySelector<HTMLElement>(`[data-agent-id="${id}"]`))?.focus();
      pendingConfigurationFocus.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [configurationAgent, activePathname]);
  useEffect(() => {
    if (route.kind !== "project") return;
    const target = sessionStorage.getItem(routeFocusKey);
    if (!target) return;
    sessionStorage.removeItem(routeFocusKey);
    const separator = target.indexOf(":");
    const kind = target.slice(0, separator);
    const agentId = target.slice(separator + 1);
    const frame = requestAnimationFrame(() => {
      const id = CSS.escape(agentId);
      const selector = kind === "primary"
        ? `[data-agent-id="${id}"]`
        : `[data-agent-configure-id="${id}"]`;
      document.querySelector<HTMLElement>(selector)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [route.kind, activePathname]);
  const appearanceProject = data.find((item) => item.id === projectAppearanceId);
  const agentProject = data.find((item) => item.id === agentProjectId);
  const automationProject = data.find((item) => item.id === automationProjectId);
  const ideaProject = data.find((item) => item.id === ideaProjectId);
  useEffect(() => {
    if (routeProjectId && routeProjectId !== selectedId) setSelectedId(routeProjectId);
  }, [routeProjectId, selectedId, setSelectedId]);
  const refreshErrors = [...new Set([projectError?.message, healthError?.message].filter((message): message is string => Boolean(message)))];
  const scheduleProjectRefresh = useCoalescedRefresh(() => mutate()); const scheduleHealthRefresh = useCoalescedRefresh(() => mutateHealth());
  const eventUpdatesDegraded = useProjectEvents(() => { scheduleProjectRefresh(); scheduleHealthRefresh(); });
  useEffect(() => {
    if (!eventUpdatesDegraded) return;
    scheduleProjectRefresh();
    scheduleHealthRefresh();
    const timer = window.setInterval(() => {
      scheduleProjectRefresh();
      scheduleHealthRefresh();
    }, fallbackRefreshInterval);
    return () => window.clearInterval(timer);
  }, [eventUpdatesDegraded, scheduleHealthRefresh, scheduleProjectRefresh]);
  const warnings = [
    ...(eventUpdatesDegraded ? ["Live updates unavailable. Refreshing periodically."] : []),
    ...(refreshErrors.length ? [`Dashboard data may be out of date. ${refreshErrors.join(" ")}`] : []),
    ...(submissionWarningMessage ? [submissionWarningMessage] : []),
    ...(automationWarningMessage ? [automationWarningMessage] : []),
  ];
  const post = postJson;
  const refreshProjects = () => { void mutate().catch(() => undefined); }; const refreshHealth = () => { void mutateHealth().catch(() => undefined); };
  function navigate(next: Exclude<DashboardRoute, { kind: "root" }>, replace = false) {
    const href = dashboardHref(next);
    // Always replace the pending request: navigating back to the URL the router is already
    // on must clear a still-pending request rather than let it keep overriding the route.
    setRequestedRoute(href === pathname ? undefined : { href, from: pathname });
    startRouteTransition(() => {
      if (replace) router.replace(href);
      else router.push(href);
    });
  }
  function projectRoute(projectId = project?.id) {
    return projectId ? { kind: "project", projectId, view: "overview" } as const : { kind: "new-project" } as const;
  }
  function closeRoute() {
    navigate(projectRoute(), true);
  }
  const draftWorkspaces = useDraftWorkspaces({
    project,
    initialHeight: project?.id === initialSelectedProject ? initialDraftHeight : undefined,
    activeDraftId: route.kind === "draft" ? route.draftId : undefined,
    onDraftRoute: (projectId, draftId, replace) => navigate(draftId
      ? { kind: "draft", projectId, draftId }
      : { kind: "project", projectId, view: "overview" }, replace),
    onSubmitted: (result) => setSubmissionWarningMessage(submissionWarning(result)),
  });
  async function createProject(draft: ProjectDraft) {
    const result = await post("/api/projects", { name: draft.name, workspace: draft.workspace });
    if (!result.id) return refreshProjects();
    setProjectColors({ ...projectColors, [result.id]: draft.color }); if (draft.avatar) setProjectAvatars({ ...projectAvatars, [result.id]: draft.avatar }); setSelectedId(result.id);
    navigate({ kind: "project", projectId: result.id, view: "overview" }, true);
    refreshProjects();
  }
  const write = writeJson;
  function writeAgent(method: string, body?: object) {
    if (!project || !configurationAgent) return Promise.reject(new Error("Agent is no longer available."));
    const projectId = project.id;
    const agentId = configurationAgent.id;
    const operation = agentMutationQueue.current
      .catch(() => undefined)
      .then(async () => {
        const result = await write(`/api/projects/${projectId}/agents/${agentId}`, method, body, {
          expectedRevision: agentConfigurationRevision.current,
        });
        if (typeof result.revision === "number") agentConfigurationRevision.current = result.revision;
      });
    agentMutationQueue.current = operation.catch(() => undefined);
    return operation;
  }
  function writeCardAgent(agent: Agent, method: string, body?: object) {
    if (!project) return Promise.reject(new Error("Project is no longer available."));
    return write(`/api/projects/${project.id}/agents/${agent.id}`, method, body, {
      expectedRevision: agent.configurationRevision,
    });
  }
  async function selectProject(id: string) {
    if (!await draftWorkspaces.saveAll()) return;
    if (
      id !== project?.id
      && configuration
      && agentConfigurationRef.current
      && !await agentConfigurationRef.current.requestClose()
    ) return;
    setSelectedId(id);
    navigate({ kind: "project", projectId: id, view: "overview" });
  }
  async function closeAgentWorkspace() {
    if (agentConfigurationRef.current && !await agentConfigurationRef.current.requestClose()) return;
    const returnFocus = configurationReturnFocus.current;
    const agentId = configuration?.agentId;
    pendingConfigurationFocus.current = agentId;
    if (agentId) sessionStorage.setItem(routeFocusKey, `configure:${agentId}`);
    navigate(projectRoute(), true);
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  return (
    <div
      ref={shellRef}
      className={styles.shell}
      style={shellStyle}
      data-app-shell
      data-agent-workspace={configurationAgent ? "true" : undefined}
      data-route-kind={route.kind}
      data-route-pathname={activePathname}
      data-route-agent={chat?.agentId}
      data-chat-agent={chatAgent?.id}
    >
      <ProjectSidebar
        projects={data}
        colors={projectColors}
        avatars={projectAvatars}
        selected={project?.id}
        onSelect={(id) => { void selectProject(id); }}
        onNew={() => navigate({ kind: "new-project" })}
        onAppearance={(target) => navigate({ kind: "project-settings", projectId: target.id, section: "appearance" })}
        onWorkflow={(target) => navigate({ kind: "project-settings", projectId: target.id, section: "workflow" })}
        health={health}
        onHealth={() => navigate({ kind: "system" })}
        onSettings={() => navigate({ kind: "settings" })}
        onPause={async (target) => { await write(`/api/projects/${target.id}`, "PATCH", { paused: !target.paused }); await mutate(); }}
        onDelete={async (target, confirmation) => {
          await write(`/api/projects/${target.id}`, "DELETE", { confirmation });
          if (target.id === project?.id) {
            const nextId = data.find((item) => item.id !== target.id)?.id;
            setSelectedId(nextId || "");
            navigate(nextId ? { kind: "project", projectId: nextId, view: "overview" } : { kind: "new-project" }, true);
          }
          await mutate();
        }}
      />
      {wideLayout && <div className={styles.railControl} role="region" aria-label="Project navigation resize control"><ResizeHandle
        className={`${styles.railResizeHandle} ${styles.projectNavSplitter}`}
        orientation="vertical"
        label="Resize project navigation"
        controls="project-navigation-rail"
        value={dashboardWidths.projectNav}
        min={DASHBOARD_RAILS.projectNav.min}
        max={projectNavMax}
        defaultValue={DASHBOARD_RAILS.projectNav.default}
        onPreview={(value) => previewRail("projectNav", value)}
        onCommit={(value) => commitRail("projectNav", value)}
        onCancel={cancelPreview}
      /></div>}
      {warnings.length > 0 && <p className={styles.refreshError} role="alert">{warnings.join(" ")}</p>}
      {configurationAgent && project ? <AgentWorkspace
        ref={agentConfigurationRef}
        key={`${project.id}:${configurationAgent.id}`}
        agent={configurationAgent}
        settings={modelSettings}
        settingsError={modelSettingsError?.message}
        color={projectAgentColor(colors, project.id, configurationAgent.id)}
        avatar={agentAppearanceOverride(avatars, project.id, configurationAgent.id)}
        onBack={closeAgentWorkspace}
        onConversation={() => navigate({ kind: "conversation", projectId: project.id, agentId: configurationAgent.id })}
        onColor={(color) => setColors(updateAgentAppearance(colors, project.id, configurationAgent.id, color))}
        onAvatar={(avatar) => setAvatars(updateAgentAppearance(avatars, project.id, configurationAgent.id, avatar))}
        onSaveDetails={async (details) => { await writeAgent("PUT", { details }); await mutate(); }}
        onSaveInstructions={async (instructions) => { await writeAgent("PUT", { instructions }); await mutate(); }}
        onSaveModel={async (model) => { await writeAgent("PUT", { model: { model } }); await mutate(); }}
        onRetryModels={() => mutateModelSettings()}
        onMakeLeader={async () => {
          await write(`/api/projects/${project.id}/agents/${configurationAgent.id}`, "PATCH", { action: "make-leader" });
          await mutate();
        }}
        onDelegateToggle={async () => {
          await write(`/api/projects/${project.id}/agents/${configurationAgent.id}`, "PATCH", { action: configurationAgent.isDelegate ? "revoke-delegate" : "grant-delegate" });
          await mutate();
        }}
        onPauseToggle={async () => {
          await write(`/api/projects/${project.id}/agents/${configurationAgent.id}`, "PATCH", { action: configurationAgent.status === "paused" ? "resume" : "pause" });
          await mutate();
        }}
        onReset={async () => {
          await write(`/api/projects/${project.id}/agents/${configurationAgent.id}`, "PATCH", { action: "clear-context" });
          await mutate();
        }}
        onDelete={async () => {
          await writeAgent("DELETE");
          navigate(projectRoute(), true);
          await mutate();
        }}
        onDeletionPreview={async () => {
          const response = await fetch(`/api/projects/${project.id}/agents/${configurationAgent.id}`);
          const body = await response.json().catch(() => undefined);
          if (!response.ok) throw new Error(body?.error || "Could not check whether this agent can be deleted.");
          return body;
        }}
      /> : project ? <ProjectView
        project={project}
        colors={colors}
        avatars={avatars}
        workspaceView={workspaceView}
        onWorkspaceView={(view) => navigate({ kind: "project", projectId: project.id, view })}
        onAgent={(_agent, returnFocus) => {
          chatReturnFocus.current = returnFocus;
        }}
        onConfigureAgent={(_agent, returnFocus) => {
          configurationReturnFocus.current = returnFocus;
        }}
        onPrefetch={(agent) => prefetchConversation(project.id, agent.id)}
        onAgentPauseToggle={async (agent) => {
          await writeCardAgent(agent, "PATCH", { action: agent.status === "paused" ? "resume" : "pause" });
          await mutate();
        }}
        onAgentClearContext={async (agent) => {
          await writeCardAgent(agent, "PATCH", { action: "clear-context" });
          await mutate();
        }}
        onAgentDelete={async (agent) => {
          await writeCardAgent(agent, "DELETE");
          await mutate();
        }}
        onAgentDeletionPreview={async (agent) => {
          const response = await fetch(`/api/projects/${project.id}/agents/${agent.id}`);
          const body = await response.json().catch(() => undefined);
          if (!response.ok) throw new Error(body?.error || "Could not check whether this agent can be deleted.");
          return body;
        }}
        onTask={(item) => {
          if (item.status === "draft") {
            draftWorkspaces.open(project.id, item);
          } else if (item.agentId) navigate({ kind: "conversation", projectId: project.id, agentId: item.agentId });
        }}
        onTaskCancel={async (item) => {
          await write(`/api/projects/${project.id}/work-items`, "PATCH", { id: item.id });
          await mutate();
        }}
        onTaskDelete={async (item) => {
          await write(`/api/projects/${project.id}/work-items`, "DELETE", { id: item.id });
          await mutate();
        }}
        onDelegation={(item) => item.agentId && navigate({ kind: "conversation", projectId: project.id, agentId: item.agentId, focusId: item.chatId })}
        onDelegationCancel={async (item) => {
          await write(`/api/projects/${project.id}/work-items`, "PATCH", { id: item.id });
          await mutate();
        }}
        onAddWork={draftWorkspaces.create}
        onAddAgent={() => navigate({ kind: "new-agent", projectId: project.id })}
        onConfigureProject={() => navigate({ kind: "project-settings", projectId: project.id, section: "workflow" })}
        onConfigureIdeas={() => navigate({ kind: "project-settings", projectId: project.id, section: "ideas" })}
      /> : <EmptyProject onCreate={() => navigate({ kind: "new-project" })} />}
      {!configurationAgent && project && <ActivityRail responsiveVisible={workspaceView === "activity"} project={project} cutoff={activityCutoffs[project.id]} onClear={() => setActivityCutoffs({ ...activityCutoffs, [project.id]: new Date().toISOString() })} onOpen={(agent, focusId) => navigate({ kind: "conversation", projectId: project.id, agentId: agent.id, focusId })} />}
      {!configurationAgent && wideLayout && project && <div className={styles.railControl} role="region" aria-label="Recent activity resize control"><ResizeHandle
        className={`${styles.railResizeHandle} ${styles.activitySplitter}`}
        orientation="vertical"
        direction={-1}
        label="Resize recent activity"
        controls="recent-activity-rail"
        value={dashboardWidths.activity}
        min={DASHBOARD_RAILS.activity.min}
        max={activityMax}
        defaultValue={DASHBOARD_RAILS.activity.default}
        onPreview={(value) => previewRail("activity", value)}
        onCommit={(value) => commitRail("activity", value)}
        onCancel={cancelPreview}
      /></div>}
      {!configurationAgent && (draftWorkspaces.view || draftWorkspaces.placeholder)}
      {chatAgent && <ActionDrawer title="" ariaLabel={`Conversation with ${chatAgent.title || chatAgent.id}`} open wide onClose={() => {
        const returnFocus = chatReturnFocus.current;
        sessionStorage.setItem(routeFocusKey, `primary:${chatAgent.id}`);
        closeRoute();
        requestAnimationFrame(() => returnFocus?.focus());
      }}>
        {chat && project && <ConversationDrawer
          key={`${project.id}:${chatAgent.id}:${chat.focusId || "latest"}`}
          projectId={project.id}
          agent={chatAgent}
          colors={colors}
          avatars={avatars}
          focusId={chat.focusId}
          onConfigure={() => {
            configurationReturnFocus.current = chatReturnFocus.current;
            navigate({ kind: "agent-settings", projectId: project.id, agentId: chatAgent.id }, true);
          }}
          onReturnLatest={() => navigate({ kind: "conversation", projectId: project.id, agentId: chatAgent.id }, true)}
          onProjectMutate={mutate}
          onSubmissionWarning={setSubmissionWarningMessage}
        />}
      </ActionDrawer>}
      {addingProject && <NewProjectDialog open workspaceRoot={workspaceRoot} onBrowse={browseWorkspace} onCreate={createProject} onClose={closeRoute} />}
      {agentProject && <NewAgentDialog open project={agentProject} settings={modelSettings} settingsError={modelSettingsError?.message} onClose={closeRoute} onCreate={async (draft: AgentDraft) => {
        if (!agentProject) return;
        await post(`/api/projects/${agentProject.id}/agents`, draft);
        navigate({ kind: "project", projectId: agentProject.id, view: "overview" }, true);
        refreshProjects();
      }} />}
      {automationProject && <AutomationDialog open project={automationProject} onClose={closeRoute} onSave={async (draft) => {
        if (!automationProject) return;
        const result = await putAutomation(`/api/projects/${automationProject.id}/automation`, {
          ...draft,
          ideaAgents: automationProject.ideaAgents || [],
        });
        navigate({ kind: "project", projectId: automationProject.id, view: "overview" }, true);
        setAutomationWarningMessage(automationWarning(result));
        await mutate().catch(() => undefined);
      }} />}
      {ideaProject && <IdeaAgentsDialog open project={ideaProject} onClose={closeRoute} onSave={async (draft) => {
        if (!ideaProject) return;
        const result = await putAutomation(`/api/projects/${ideaProject.id}/automation`, {
          maxActiveTasks: ideaProject.maxActiveTasks,
          ...draft,
        });
        navigate({ kind: "project", projectId: ideaProject.id, view: "overview" }, true);
        setAutomationWarningMessage(automationWarning(result));
        await mutate().catch(() => undefined);
      }} />}
      {appearanceProject && <ActionDrawer title={`Appearance · ${appearanceProject.name}`} open onClose={closeRoute}>
        <IdentityEditor name={appearanceProject.name} color={agentColor(appearanceProject.id, projectColors)} avatar={projectAvatars[appearanceProject.id]} onColor={(color) => setProjectColors({ ...projectColors, [appearanceProject.id]: color })} onAvatar={(avatar) => {
          const next = { ...projectAvatars };
          if (avatar) next[appearanceProject.id] = avatar;
          else delete next[appearanceProject.id];
          setProjectAvatars(next);
        }} />
      </ActionDrawer>}
      {showHealth && <ActionDrawer title="System status" open onClose={closeRoute}>
        <SystemStatus health={health} onRestart={async (projectId) => {
          await post("/api/health", { projectId });
          refreshProjects();
          refreshHealth();
        }} />
      </ActionDrawer>}
      {showSettings && <ActionDrawer title="Global settings" open onClose={closeRoute}>
        <GlobalSettingsForm settings={modelSettings} error={modelSettingsError?.message} onRetry={() => mutateModelSettings()} onSave={async (defaultModel) => {
          await write("/api/settings", "PUT", { defaultModel });
          await mutateModelSettings();
        }} />
      </ActionDrawer>}
    </div>
  );
}
