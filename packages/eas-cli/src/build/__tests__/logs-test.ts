import { AppPlatform, BuildStatus } from "../../graphql/generated";
import { BuildQuery } from "../../graphql/queries/BuildQuery";
import Log from "../../log";
import fetch from "../../fetch";
import {
  parseBuildLogLines,
  streamBuildLogsAsync,
  streamBuildsLogsAsync,
} from "../logs";

jest.mock("../../graphql/queries/BuildQuery");
jest.mock("../../fetch");
jest.mock("../../log");
jest.mock("../../ora", () => ({
  ora: () => ({
    start(text?: string) {
      return {
        text,
        succeed: jest.fn(),
        fail: jest.fn(),
        warn: jest.fn(),
      };
    },
  }),
}));

describe("build log streaming", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("parses only valid JSON log lines", () => {
    expect(
      parseBuildLogLines('{"msg":"first"}\nnot-json\n{"msg":"second"}\n'),
    ).toEqual([{ msg: "first" }, { msg: "second" }]);
  });

  it("streams only newly appended log lines across rotated log file urls", async () => {
    const inProgressBuild = buildFragment({
      status: BuildStatus.InProgress,
      logFiles: ["https://example.com/logs/build.txt?token=first"],
    });
    const finishedBuild = buildFragment({
      status: BuildStatus.Finished,
      logFiles: ["https://example.com/logs/build.txt?token=second"],
    });

    jest.mocked(fetch).mockResolvedValueOnce({
      text: async () =>
        [
          JSON.stringify({ marker: "START_PHASE", phase: "PREBUILD" }),
          JSON.stringify({ phase: "PREBUILD", msg: "first line" }),
        ].join("\n"),
    } as any);
    jest.mocked(fetch).mockResolvedValueOnce({
      text: async () =>
        [
          JSON.stringify({ marker: "START_PHASE", phase: "PREBUILD" }),
          JSON.stringify({ phase: "PREBUILD", msg: "first line" }),
          JSON.stringify({ phase: "PREBUILD", msg: "second line" }),
        ].join("\n"),
    } as any);
    jest
      .mocked(BuildQuery.byIdAsync)
      .mockResolvedValueOnce(finishedBuild as any);

    const finalBuild = await streamBuildLogsAsync(
      {} as any,
      inProgressBuild as any,
      {
        pollIntervalMs: 0,
      },
    );

    expect(finalBuild).toBe(finishedBuild);
    expect(fetch).toHaveBeenNthCalledWith(1, inProgressBuild.logFiles[0], {
      method: "GET",
    });
    expect(fetch).toHaveBeenNthCalledWith(2, finishedBuild.logFiles[0], {
      method: "GET",
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining("Prebuild"));
    expect(Log.log).toHaveBeenCalledWith("  first line");
    expect(Log.log).toHaveBeenCalledWith("  second line");
    expect(
      jest
        .mocked(Log.log)
        .mock.calls.filter(([message]) => message === "  first line"),
    ).toHaveLength(1);
  });

  it("streams multiple builds with platform labels", async () => {
    const androidBuild = buildFragment({
      id: "android-build",
      platform: AppPlatform.Android,
      status: BuildStatus.Finished,
      logFiles: ["https://example.com/logs/android.txt?token=1"],
    });
    const iosBuild = buildFragment({
      id: "ios-build",
      platform: AppPlatform.Ios,
      status: BuildStatus.Finished,
      logFiles: ["https://example.com/logs/ios.txt?token=1"],
    });

    jest
      .mocked(fetch)
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({ phase: "PREBUILD", msg: "android line" }),
      } as any)
      .mockResolvedValueOnce({
        text: async () =>
          JSON.stringify({ phase: "PREBUILD", msg: "ios line" }),
      } as any);

    const builds = await streamBuildsLogsAsync(
      {} as any,
      [androidBuild as any, iosBuild as any],
      {
        pollIntervalMs: 0,
      },
    );

    expect(builds).toEqual([androidBuild, iosBuild]);
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining("[Android]"));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining("[iOS]"));
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining("android line"),
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining("ios line"));
  });
});

function buildFragment(
  overrides: Partial<{
    id: string;
    platform: AppPlatform;
    status: BuildStatus;
    logFiles: string[];
  }>,
) {
  return {
    id: "build-id",
    platform: AppPlatform.Android,
    status: BuildStatus.InProgress,
    logFiles: [],
    ...overrides,
  };
}
