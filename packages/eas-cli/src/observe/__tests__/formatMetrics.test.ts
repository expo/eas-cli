import {
  AppPlatform,
  BuildPriority,
  BuildStatus,
} from "../../graphql/generated";
import {
  ObserveMetricsMap,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  makeMetricsKey,
} from "../formatMetrics";

function createMockBuild(overrides: {
  id: string;
  platform: AppPlatform;
  appVersion: string | null;
  buildProfile?: string | null;
  completedAt?: string | null;
  gitCommitHash?: string | null;
}): ReturnType<typeof createBuildFragment> {
  return createBuildFragment(overrides);
}

function createBuildFragment(overrides: {
  id: string;
  platform: AppPlatform;
  appVersion: string | null;
  buildProfile?: string | null;
  completedAt?: string | null;
  gitCommitHash?: string | null;
}) {
  return {
    __typename: "Build" as const,
    id: overrides.id,
    status: BuildStatus.Finished,
    platform: overrides.platform,
    appVersion: overrides.appVersion,
    appBuildVersion: "1",
    buildProfile: overrides.buildProfile ?? "production",
    completedAt: overrides.completedAt ?? "2025-01-15T10:00:00.000Z",
    createdAt: "2025-01-15T09:00:00.000Z",
    updatedAt: "2025-01-15T10:00:00.000Z",
    channel: "production",
    distribution: null,
    iosEnterpriseProvisioning: null,
    sdkVersion: "52.0.0",
    runtimeVersion: "1.0.0",
    gitCommitHash: overrides.gitCommitHash ?? "abc1234567890",
    gitCommitMessage: "test commit",
    initialQueuePosition: null,
    queuePosition: null,
    estimatedWaitTimeLeftSeconds: null,
    priority: BuildPriority.Normal,
    message: null,
    expirationDate: null,
    isForIosSimulator: false,
    error: null,
    artifacts: null,
    fingerprint: null,
    initiatingActor: null,
    logFiles: [],
    project: {
      __typename: "App" as const,
      id: "project-id",
      name: "test-app",
      slug: "test-app",
      ownerAccount: { id: "account-id", name: "test-owner" },
    },
    metrics: null,
  };
}

const DEFAULT_METRICS = [
  "expo.app_startup.cold_launch_time",
  "expo.app_startup.tti",
];

function makeMetricValues(
  min: number | null,
  median: number | null,
  max: number | null,
) {
  return { min, median, max };
}

describe(buildObserveMetricsTable, () => {
  it("formats builds grouped by version with min, median, max columns", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: "1.2.0",
        gitCommitHash: "aaa1111222233334444",
      }),
      createMockBuild({
        id: "build-2",
        platform: AppPlatform.Ios,
        appVersion: "1.2.0",
        gitCommitHash: "bbb2222333344445555",
      }),
      createMockBuild({
        id: "build-3",
        platform: AppPlatform.Android,
        appVersion: "1.1.0",
        gitCommitHash: "ccc3333444455556666",
      }),
    ];

    const metricsMap: ObserveMetricsMap = new Map();
    const iosKey = makeMetricsKey("1.2.0", AppPlatform.Ios);
    metricsMap.set(
      iosKey,
      new Map([
        ["expo.app_startup.cold_launch_time", makeMetricValues(0.05, 0.2, 0.8)],
        ["expo.app_startup.tti", makeMetricValues(0.03, 0.12, 0.5)],
      ]),
    );

    const androidKey = makeMetricsKey("1.1.0", AppPlatform.Android);
    metricsMap.set(
      androidKey,
      new Map([
        ["expo.app_startup.cold_launch_time", makeMetricValues(0.06, 0.25, 0.9)],
        ["expo.app_startup.tti", makeMetricValues(0.04, 0.15, 0.6)],
      ]),
    );

    const output = buildObserveMetricsTable(builds, metricsMap, DEFAULT_METRICS);

    // The header is bolded, thus the escape characters in the snapshot
    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits           Cold Launch Min  Cold Launch Med  Cold Launch Max  TTI Min  TTI Med  TTI Max[22m
-----------  --------  ------------  ----------------  ---------------  ---------------  ---------------  -------  -------  -------
1.2.0        iOS       Jan 15, 2025  aaa1111, bbb2222  0.05s            0.20s            0.80s            0.03s    0.12s    0.50s  
1.1.0        Android   Jan 15, 2025  ccc3333           0.06s            0.25s            0.90s            0.04s    0.15s    0.60s  "
`);
  });

  it("shows - for builds with no matching observe data", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: "2.0.0",
      }),
    ];

    const output = buildObserveMetricsTable(builds, new Map(), DEFAULT_METRICS);

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits  Cold Launch Min  Cold Launch Med  Cold Launch Max  TTI Min  TTI Med  TTI Max[22m
-----------  --------  ------------  -------  ---------------  ---------------  ---------------  -------  -------  -------
2.0.0        iOS       Jan 15, 2025  abc1234  -                -                -                -        -        -      "
`);
  });

  it("shows - for builds with null appVersion", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: null,
      }),
    ];

    const output = buildObserveMetricsTable(builds, new Map(), DEFAULT_METRICS);

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits  Cold Launch Min  Cold Launch Med  Cold Launch Max  TTI Min  TTI Med  TTI Max[22m
-----------  --------  ------------  -------  ---------------  ---------------  ---------------  -------  -------  -------
-            iOS       Jan 15, 2025  abc1234  -                -                -                -        -        -      "
`);
  });

  it("returns message when no builds found", () => {
    const output = buildObserveMetricsTable([], new Map(), DEFAULT_METRICS);
    expect(output).toMatchInlineSnapshot(`"[33mNo finished builds found.[39m"`);
  });

  it("shows the latest build date when multiple builds share a version", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: "1.0.0",
        completedAt: "2025-01-10T10:00:00.000Z",
        gitCommitHash: "aaa1111222233334444",
      }),
      createMockBuild({
        id: "build-2",
        platform: AppPlatform.Ios,
        appVersion: "1.0.0",
        completedAt: "2025-01-20T10:00:00.000Z",
        gitCommitHash: "bbb2222333344445555",
      }),
    ];

    const output = buildObserveMetricsTable(builds, new Map(), DEFAULT_METRICS);

    expect(output).toContain("1.0.0");
    expect(output).toContain("iOS");
    expect(output).toContain("Jan 20, 2025");
    expect(output).not.toContain("Jan 10, 2025");
  });

  it("deduplicates commit hashes for same version+platform", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: "1.0.0",
        gitCommitHash: "same123456789",
      }),
      createMockBuild({
        id: "build-2",
        platform: AppPlatform.Ios,
        appVersion: "1.0.0",
        gitCommitHash: "same123456789",
      }),
    ];

    const output = buildObserveMetricsTable(builds, new Map(), DEFAULT_METRICS);

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits  Cold Launch Min  Cold Launch Med  Cold Launch Max  TTI Min  TTI Med  TTI Max[22m
-----------  --------  ------------  -------  ---------------  ---------------  ---------------  -------  -------  -------
1.0.0        iOS       Jan 15, 2025  same123  -                -                -                -        -        -      "
`);
  });
});

describe(buildObserveMetricsJson, () => {
  it("produces grouped JSON with min, median, max per metric", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: "1.0.0",
        gitCommitHash: "aaa1111222233334444",
      }),
      createMockBuild({
        id: "build-2",
        platform: AppPlatform.Ios,
        appVersion: "1.0.0",
        gitCommitHash: "bbb2222333344445555",
      }),
    ];

    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey("1.0.0", AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([["expo.app_startup.tti", makeMetricValues(0.02, 0.1, 0.4)]]),
    );

    const result = buildObserveMetricsJson(builds, metricsMap, [
      "expo.app_startup.tti",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      appVersion: "1.0.0",
      platform: AppPlatform.Ios,
      lastBuildDate: "2025-01-15T10:00:00.000Z",
      commits: ["aaa1111", "bbb2222"],
      metrics: {
        "expo.app_startup.tti": { min: 0.02, median: 0.1, max: 0.4 },
      },
    });
  });

  it("produces null min/median/max when no observe data matches", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Android,
        appVersion: "3.0.0",
      }),
    ];

    const result = buildObserveMetricsJson(builds, new Map(), [
      "expo.app_startup.tti",
    ]);

    expect(result[0].metrics).toEqual({
      "expo.app_startup.tti": { min: null, median: null, max: null },
    });
  });

  it("produces null appVersion when build has no appVersion", () => {
    const builds = [
      createMockBuild({
        id: "build-1",
        platform: AppPlatform.Ios,
        appVersion: null,
      }),
    ];

    const result = buildObserveMetricsJson(builds, new Map(), [
      "expo.app_startup.tti",
    ]);

    expect(result[0].appVersion).toBeNull();
    expect(result[0].metrics["expo.app_startup.tti"]).toEqual({
      min: null,
      median: null,
      max: null,
    });
  });
});

describe(makeMetricsKey, () => {
  it("creates a key from version and platform", () => {
    expect(makeMetricsKey("1.0.0", AppPlatform.Ios)).toBe("1.0.0:IOS");
    expect(makeMetricsKey("2.0.0", AppPlatform.Android)).toBe("2.0.0:ANDROID");
  });
});
