"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStoredRecord } from "@/lib/use-stored-record";
import {
  DASHBOARD_LAYOUT_COOKIE_KEY,
  DASHBOARD_LAYOUT_ENTRY,
  DASHBOARD_LAYOUT_STORAGE_KEY,
  dynamicRailMax,
  effectiveDashboardWidths,
  parseDashboardLayout,
  preferredWidths,
  updateDashboardLayout,
  type DashboardRail,
  type DashboardWidths,
} from "./dashboard-layout";

export function useDashboardLayout(initialLayout?: string) {
  const [records, setRecords] = useStoredRecord(DASHBOARD_LAYOUT_STORAGE_KEY);
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellWidth, setShellWidth] = useState<number>();
  const [preview, setPreview] = useState<Partial<DashboardWidths>>();

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const updateWidth = () => setShellWidth(shell.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const layout = parseDashboardLayout(records[DASHBOARD_LAYOUT_ENTRY] || initialLayout);
  const storedWidths = preferredWidths(layout);
  const requestedWidths = {
    projectNav: preview?.projectNav ?? storedWidths.projectNav,
    activity: preview?.activity ?? storedWidths.activity,
  };
  const widths = effectiveDashboardWidths(shellWidth, requestedWidths);

  const previewRail = (rail: DashboardRail, value: number) => {
    setPreview((current) => ({
      projectNav: current?.projectNav ?? widths.projectNav,
      activity: current?.activity ?? widths.activity,
      [rail]: value,
    }));
  };
  const commitRail = (rail: DashboardRail, value: number) => {
    setPreview(undefined);
    const nextLayout = updateDashboardLayout(layout, rail, value);
    setRecords({
      ...records,
      [DASHBOARD_LAYOUT_ENTRY]: JSON.stringify(nextLayout),
    });
    document.cookie = `${DASHBOARD_LAYOUT_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(nextLayout))}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  return {
    shellRef,
    shellStyle: {
      "--project-nav-width": `${widths.projectNav}px`,
      "--activity-width": `${widths.activity}px`,
    } as CSSProperties,
    wide: Boolean(shellWidth && shellWidth > 1050),
    widths,
    projectNavMax: dynamicRailMax("projectNav", shellWidth, widths.activity),
    activityMax: dynamicRailMax("activity", shellWidth, widths.projectNav),
    previewRail,
    commitRail,
    cancelPreview: () => setPreview(undefined),
  };
}
