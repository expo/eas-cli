import { AppObserveEvent } from "../../graphql/generated";
import {
  buildObserveEventsJson,
  buildObserveEventsTable,
} from "../formatEvents";

function createMockEvent(
  overrides: Partial<AppObserveEvent> = {},
): AppObserveEvent {
  return {
    __typename: "AppObserveEvent",
    id: "evt-1",
    metricName: "expo.app_startup.tti",
    metricValue: 1.23,
    timestamp: "2025-01-15T10:30:00.000Z",
    appVersion: "1.0.0",
    appBuildNumber: "42",
    appIdentifier: "com.example.app",
    appName: "ExampleApp",
    deviceModel: "iPhone 15",
    deviceOs: "iOS",
    deviceOsVersion: "17.0",
    countryCode: "US",
    sessionId: "session-1",
    easClientId: "client-1",
    eventBatchId: "batch-1",
    tags: {},
    ...overrides,
  };
}

describe(buildObserveEventsTable, () => {
  it("formats events into aligned columns", () => {
    const events = [
      createMockEvent({
        metricName: "expo.app_startup.tti",
        metricValue: 1.23,
        appVersion: "1.2.0",
        appBuildNumber: "42",
        deviceOs: "iOS",
        deviceOsVersion: "17.0",
        deviceModel: "iPhone 15",
        countryCode: "US",
        timestamp: "2025-01-15T10:30:00.000Z",
      }),
      createMockEvent({
        id: "evt-2",
        metricName: "expo.app_startup.tti",
        metricValue: 0.85,
        appVersion: "1.1.0",
        appBuildNumber: "38",
        deviceOs: "Android",
        deviceOsVersion: "14",
        deviceModel: "Pixel 8",
        countryCode: "PL",
        timestamp: "2025-01-14T08:15:00.000Z",
      }),
    ];

    const output = buildObserveEventsTable(events);

    // Escape codes are included, because the header is bolded.
    expect(output).toMatchInlineSnapshot(`
"[1mMetric  Value  App Version  Platform    Device     Country  Timestamp             [22m
------  -----  -----------  ----------  ---------  -------  ----------------------
TTI     1.23s  1.2.0 (42)   iOS 17.0    iPhone 15  US       Jan 15, 2025, 10:30 AM
TTI     0.85s  1.1.0 (38)   Android 14  Pixel 8    PL       Jan 14, 2025, 08:15 AM"
`);
  });

  it("returns yellow warning for empty array", () => {
    const output = buildObserveEventsTable([]);
    expect(output).toContain("No events found.");
  });

  it("uses short names for known metrics", () => {
    const events = [
      createMockEvent({ metricName: "expo.app_startup.cold_launch_time" }),
      createMockEvent({
        id: "evt-2",
        metricName: "expo.app_startup.warm_launch_time",
      }),
      createMockEvent({ id: "evt-3", metricName: "expo.app_startup.ttr" }),
      createMockEvent({
        id: "evt-4",
        metricName: "expo.app_startup.bundle_load_time",
      }),
    ];

    const output = buildObserveEventsTable(events);

    expect(output).toContain("Cold Launch");
    expect(output).toContain("Warm Launch");
    expect(output).toContain("TTR");
    expect(output).toContain("Bundle Load");
  });

  it("shows - for null countryCode", () => {
    const events = [createMockEvent({ countryCode: null })];
    const output = buildObserveEventsTable(events);

    // The country column should contain a dash
    const lines = output.split("\n");
    const dataLine = lines[2]; // header, separator, first data row
    expect(dataLine).toContain("-");
  });
});

describe(buildObserveEventsJson, () => {
  it("maps event to JSON shape with all relevant fields", () => {
    const events = [
      createMockEvent({
        id: "evt-1",
        metricName: "expo.app_startup.tti",
        metricValue: 1.23,
        appVersion: "1.0.0",
        appBuildNumber: "42",
        deviceModel: "iPhone 15",
        deviceOs: "iOS",
        deviceOsVersion: "17.0",
        countryCode: "US",
        sessionId: "session-1",
        easClientId: "client-1",
        timestamp: "2025-01-15T10:30:00.000Z",
      }),
    ];

    const result = buildObserveEventsJson(events);

    expect(result).toEqual([
      {
        id: "evt-1",
        metricName: "expo.app_startup.tti",
        metricValue: 1.23,
        appVersion: "1.0.0",
        appBuildNumber: "42",
        deviceModel: "iPhone 15",
        deviceOs: "iOS",
        deviceOsVersion: "17.0",
        countryCode: "US",
        sessionId: "session-1",
        easClientId: "client-1",
        timestamp: "2025-01-15T10:30:00.000Z",
      },
    ]);
  });

  it("handles null optional fields", () => {
    const events = [
      createMockEvent({
        countryCode: null,
        sessionId: null,
      }),
    ];

    const result = buildObserveEventsJson(events);

    expect(result[0].countryCode).toBeNull();
    expect(result[0].sessionId).toBeNull();
  });

  it("returns empty array for empty input", () => {
    expect(buildObserveEventsJson([])).toEqual([]);
  });
});
