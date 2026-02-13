import chalk from "chalk";

import { AppPlatform, BuildFragment } from "../graphql/generated";
import { appPlatformDisplayNames } from "../platform";

const METRIC_SHORT_NAMES: Record<string, string> = {
  "expo.app_startup.cold_launch_time": "Cold Launch",
  "expo.app_startup.warm_launch_time": "Warm Launch",
  "expo.app_startup.tti": "TTI",
  "expo.app_startup.ttr": "TTR",
  "expo.app_startup.bundle_load_time": "Bundle Load",
};

function getMetricDisplayName(metricName: string): string {
  return METRIC_SHORT_NAMES[metricName] ?? metricName;
}

function formatSeconds(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }
  return `${value.toFixed(2)}s`;
}

export interface MetricValues {
  min: number | null | undefined;
  max: number | null | undefined;
  median: number | null | undefined;
}

type ObserveMetricsKey = `${string}:${AppPlatform}`;

export type ObserveMetricsMap = Map<
  ObserveMetricsKey,
  Map<string, MetricValues> // metricName → { min, max, median }
>;

export function makeMetricsKey(
  appVersion: string,
  platform: AppPlatform,
): ObserveMetricsKey {
  return `${appVersion}:${platform}`;
}

interface VersionGroup {
  appVersion: string;
  platform: AppPlatform;
  commits: Set<string>;
  lastBuildDate: string | null;
}

function groupBuildsByVersion(builds: BuildFragment[]): VersionGroup[] {
  const grouped = new Map<ObserveMetricsKey, VersionGroup>();

  for (const build of builds) {
    const version = build.appVersion ?? "-";
    const key = makeMetricsKey(version, build.platform);

    if (!grouped.has(key)) {
      grouped.set(key, {
        appVersion: version,
        platform: build.platform,
        commits: new Set(),
        lastBuildDate: build.completedAt ?? null,
      });
    } else {
      const group = grouped.get(key)!;
      if (
        build.completedAt &&
        (!group.lastBuildDate || build.completedAt > group.lastBuildDate)
      ) {
        group.lastBuildDate = build.completedAt;
      }
    }

    if (build.gitCommitHash) {
      grouped.get(key)!.commits.add(build.gitCommitHash.slice(0, 7));
    }
  }

  return [...grouped.values()];
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "-";
  }
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface MetricValuesJson {
  min: number | null;
  median: number | null;
  max: number | null;
}

export interface ObserveMetricsVersionResult {
  appVersion: string | null;
  platform: AppPlatform;
  lastBuildDate: string | null;
  commits: string[];
  metrics: Record<string, MetricValuesJson>;
}

export function buildObserveMetricsJson(
  builds: BuildFragment[],
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
): ObserveMetricsVersionResult[] {
  const groups = groupBuildsByVersion(builds);

  return groups.map((group) => {
    const key =
      group.appVersion !== "-"
        ? makeMetricsKey(group.appVersion, group.platform)
        : null;
    const versionMetrics = key ? metricsMap.get(key) : undefined;

    const metrics: Record<string, MetricValuesJson> = {};
    for (const metricName of metricNames) {
      const values = versionMetrics?.get(metricName);
      metrics[metricName] = {
        min: values?.min ?? null,
        median: values?.median ?? null,
        max: values?.max ?? null,
      };
    }

    return {
      appVersion: group.appVersion !== "-" ? group.appVersion : null,
      platform: group.platform,
      lastBuildDate: group.lastBuildDate,
      commits: [...group.commits],
      metrics,
    };
  });
}

export function buildObserveMetricsTable(
  builds: BuildFragment[],
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
): string {
  const results = buildObserveMetricsJson(builds, metricsMap, metricNames);

  if (results.length === 0) {
    return chalk.yellow("No finished builds found.");
  }

  const fixedHeaders = ["App Version", "Platform", "Last Build", "Commits"];
  const metricHeaders: string[] = [];
  for (const m of metricNames) {
    const name = getMetricDisplayName(m);
    metricHeaders.push(`${name} Min`, `${name} Med`, `${name} Max`);
  }
  const headers = [...fixedHeaders, ...metricHeaders];

  const rows: string[][] = results.map((result) => {
    const metricCells: string[] = [];
    for (const m of metricNames) {
      const values = result.metrics[m];
      metricCells.push(
        formatSeconds(values?.min ?? null),
        formatSeconds(values?.median ?? null),
        formatSeconds(values?.max ?? null),
      );
    }

    return [
      result.appVersion ?? "-",
      appPlatformDisplayNames[result.platform],
      formatDate(result.lastBuildDate),
      result.commits.length > 0 ? result.commits.join(", ") : "-",
      ...metricCells,
    ];
  });

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const separatorLine = colWidths.map((w) => "-".repeat(w)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join("  "),
  );

  return [chalk.bold(headerLine), separatorLine, ...dataLines].join("\n");
}
