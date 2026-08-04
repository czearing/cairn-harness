export const DASHBOARD_LAYOUT_STORAGE_KEY = "harness-dashboard-layouts";
export const DASHBOARD_LAYOUT_ENTRY = "operations-dashboard";
export const DASHBOARD_LAYOUT_COOKIE_KEY = "harness-dashboard-layout";
export const DASHBOARD_LAYOUT_VERSION = 1;
export const DASHBOARD_CENTER_MIN = 480;

export const DASHBOARD_RAILS = {
  projectNav: { default: 220, min: 180, max: 360 },
  activity: { default: 280, min: 240, max: 480 },
} as const;

export type DashboardRail = keyof typeof DASHBOARD_RAILS;

export interface DashboardLayout {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  preset: "balanced" | "custom";
  projectNav: { preferredWidth: number; visible: boolean };
  activity: { preferredWidth: number; visible: boolean };
}

export interface DashboardWidths {
  projectNav: number;
  activity: number;
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  version: DASHBOARD_LAYOUT_VERSION,
  preset: "balanced",
  projectNav: { preferredWidth: DASHBOARD_RAILS.projectNav.default, visible: true },
  activity: { preferredWidth: DASHBOARD_RAILS.activity.default, visible: true },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function parseDashboardLayout(value: string | undefined): DashboardLayout {
  if (!value) return DEFAULT_DASHBOARD_LAYOUT;
  try {
    const parsed = JSON.parse(value) as Partial<DashboardLayout>;
    if (
      parsed.version !== DASHBOARD_LAYOUT_VERSION
      || (parsed.preset !== "balanced" && parsed.preset !== "custom")
      || !validRail(parsed.projectNav, "projectNav")
      || !validRail(parsed.activity, "activity")
    ) return DEFAULT_DASHBOARD_LAYOUT;
    return parsed as DashboardLayout;
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

function validRail(value: DashboardLayout[DashboardRail] | undefined, rail: DashboardRail) {
  return Boolean(
    value
    && typeof value.preferredWidth === "number"
    && Number.isFinite(value.preferredWidth)
    && value.preferredWidth >= DASHBOARD_RAILS[rail].min
    && value.preferredWidth <= DASHBOARD_RAILS[rail].max
    && typeof value.visible === "boolean",
  );
}

export function preferredWidths(layout: DashboardLayout): DashboardWidths {
  return {
    projectNav: layout.projectNav.preferredWidth,
    activity: layout.activity.preferredWidth,
  };
}

export function effectiveDashboardWidths(
  shellWidth: number | undefined,
  preferred: DashboardWidths,
): DashboardWidths {
  const projectNav = clamp(preferred.projectNav, DASHBOARD_RAILS.projectNav.min, DASHBOARD_RAILS.projectNav.max);
  const activity = clamp(preferred.activity, DASHBOARD_RAILS.activity.min, DASHBOARD_RAILS.activity.max);
  if (!shellWidth) return { projectNav, activity };

  const available = Math.max(
    DASHBOARD_RAILS.projectNav.min + DASHBOARD_RAILS.activity.min,
    shellWidth - DASHBOARD_CENTER_MIN,
  );
  const overflow = projectNav + activity - available;
  if (overflow <= 0) return { projectNav, activity };

  const projectCapacity = projectNav - DASHBOARD_RAILS.projectNav.min;
  const activityCapacity = activity - DASHBOARD_RAILS.activity.min;
  const capacity = projectCapacity + activityCapacity;
  const projectReduction = capacity
    ? Math.min(projectCapacity, overflow * (projectCapacity / capacity))
    : 0;
  const effectiveProject = projectNav - projectReduction;
  const effectiveActivity = activity - (overflow - projectReduction);
  return {
    projectNav: Math.round(effectiveProject),
    activity: Math.round(effectiveActivity),
  };
}

export function dynamicRailMax(
  rail: DashboardRail,
  shellWidth: number | undefined,
  otherWidth: number,
) {
  const bounds = DASHBOARD_RAILS[rail];
  if (!shellWidth) return bounds.max;
  return Math.max(bounds.min, Math.min(bounds.max, shellWidth - DASHBOARD_CENTER_MIN - otherWidth));
}

export function updateDashboardLayout(
  layout: DashboardLayout,
  rail: DashboardRail,
  preferredWidth: number,
): DashboardLayout {
  const next = {
    ...layout,
    [rail]: { ...layout[rail], preferredWidth },
  };
  return {
    ...next,
    preset: "custom",
  };
}
