import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import { vol } from 'memfs';

import {
  copyLatestAttemptXml,
  mergeJUnitReports,
  parseFailedFlowsFromJUnit,
  parseFlowMetadata,
  parseJUnitTestCases,
  parseMaestroResults,
} from '../maestroResultParser';

describe(parseFlowMetadata, () => {
  it('parses valid ai-*.json', async () => {
    vol.fromJSON({
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/Users/expo/workingdir/build/.maestro/home.yml',
      }),
    });

    const result = await parseFlowMetadata('/tests/2026-01-28_055409/ai-home.json');
    expect(result).toEqual({
      flow_name: 'home',
      flow_file_path: '/Users/expo/workingdir/build/.maestro/home.yml',
    });
  });

  it('returns null when flow_name is missing', async () => {
    vol.fromJSON({
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_file_path: '/Users/expo/workingdir/build/.maestro/home.yml',
      }),
    });

    const result = await parseFlowMetadata('/tests/2026-01-28_055409/ai-home.json');
    expect(result).toBeNull();
  });

  it('returns null when flow_file_path is missing', async () => {
    vol.fromJSON({
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
      }),
    });

    const result = await parseFlowMetadata('/tests/2026-01-28_055409/ai-home.json');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    vol.fromJSON({
      '/tests/2026-01-28_055409/ai-home.json': 'not json',
    });

    const result = await parseFlowMetadata('/tests/2026-01-28_055409/ai-home.json');
    expect(result).toBeNull();
  });
});

describe(parseMaestroResults, () => {
  it('parses JUnit results and enriches with ai-*.json metadata', async () => {
    vol.fromJSON({
      // JUnit XML (primary data)
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="2" failures="1">',
        '    <testcase id="home" name="home" classname="home" time="10.5" status="SUCCESS"/>',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="ERROR">',
        '      <failure>Tap failed</failure>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // Debug output (for flow_file_path)
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        {
          name: 'home',
          path: '.maestro/home.yml',
          status: 'passed',
          errorMessage: null,
          duration: 10500,
          retryCount: 0,
          tags: [],
          properties: {},
        },
        {
          name: 'login',
          path: '.maestro/login.yml',
          status: 'failed',
          errorMessage: 'Tap failed',
          duration: 5000,
          retryCount: 0,
          tags: [],
          properties: {},
        },
      ])
    );
  });

  it('calculates retryCount from timestamp directory occurrences', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // Two timestamp dirs = 1 retry
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055420/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    expect(results[0].retryCount).toBe(1);
  });

  it('uses flow name as fallback path when ai-*.json not found', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // No ai-*.json files
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    expect(results[0].path).toBe('home');
    expect(results[0].retryCount).toBe(0);
  });

  it('returns empty array when no JUnit files found', async () => {
    vol.fromJSON({
      '/junit/.gitkeep': '',
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    expect(results).toEqual([]);
  });

  it('extracts tags from JUnit properties and separates from other properties', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS">',
        '      <properties>',
        '        <property name="env" value="staging"/>',
        '        <property name="tags" value="e2e, smoke"/>',
        '      </properties>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    expect(results[0].tags).toEqual(['e2e', 'smoke']);
    expect(results[0].properties).toEqual({ env: 'staging' });
  });

  it('handles reuse_devices=true (junit_report_directory == tests_directory)', async () => {
    vol.fromJSON({
      // Same directory for both JUnit and debug output
      '/maestro-tests/android-maestro-junit.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/maestro-tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
    });

    const results = await parseMaestroResults('/maestro-tests', '/maestro-tests', '/root/project');
    expect(results).toEqual([
      expect.objectContaining({
        name: 'home',
        path: '.maestro/home.yml',
        status: 'passed',
      }),
    ]);
  });

  it('returns per-attempt results when multiple JUnit files exist for the same flow', async () => {
    vol.fromJSON({
      // Attempt 0: login FAILED
      '/junit/junit-report-flow-1-attempt-0.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="1">',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="ERROR">',
        '      <failure>Timeout</failure>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // Attempt 1: login PASSED
      '/junit/junit-report-flow-1-attempt-1.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="login" name="login" classname="login" time="3.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // ai-*.json metadata (2 timestamp dirs = 2 attempts)
      '/tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
      '/tests/2026-01-28_055420/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');

    // Should return 2 results — one per attempt
    expect(results).toHaveLength(2);
    expect(results).toEqual([
      expect.objectContaining({
        name: 'login',
        path: '.maestro/login.yml',
        status: 'failed',
        errorMessage: 'Timeout',
        duration: 5000,
        retryCount: 0,
      }),
      expect.objectContaining({
        name: 'login',
        path: '.maestro/login.yml',
        status: 'passed',
        errorMessage: null,
        duration: 3000,
        retryCount: 1,
      }),
    ]);
  });

  it('returns per-attempt results for reuse_devices=true (all flows in every attempt)', async () => {
    vol.fromJSON({
      // Attempt 0: home FAILED, login PASSED
      '/junit-reports/android-maestro-junit-attempt-0.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="2" failures="1">',
        '    <testcase id="home" name="home" classname="home" time="5.0" status="ERROR">',
        '      <failure>Timeout</failure>',
        '    </testcase>',
        '    <testcase id="login" name="login" classname="login" time="3.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // Attempt 1: both PASSED
      '/junit-reports/android-maestro-junit-attempt-1.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="2" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="4.0" status="SUCCESS"/>',
        '    <testcase id="login" name="login" classname="login" time="2.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
      '/tests/2026-01-28_055420/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055420/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    const results = await parseMaestroResults('/junit-reports', '/tests', '/root/project');

    // 4 results: 2 flows × 2 attempts
    expect(results).toHaveLength(4);
    expect(results).toEqual([
      expect.objectContaining({ name: 'home', status: 'failed', retryCount: 0 }),
      expect.objectContaining({ name: 'home', status: 'passed', retryCount: 1 }),
      expect.objectContaining({ name: 'login', status: 'passed', retryCount: 0 }),
      expect.objectContaining({ name: 'login', status: 'passed', retryCount: 1 }),
    ]);
  });

  it('returns per-attempt results with sharding (multiple testsuites per attempt file)', async () => {
    vol.fromJSON({
      // Attempt 0: shard 1 has home (FAILED), shard 2 has login (PASSED)
      '/junit-reports/android-maestro-junit-attempt-0.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" device="emulator-5554" tests="1" failures="1">',
        '    <testcase id="home" name="home" classname="home" time="5.0" status="ERROR">',
        '      <failure>Timeout</failure>',
        '    </testcase>',
        '  </testsuite>',
        '  <testsuite name="Test Suite" device="emulator-5556" tests="1" failures="0">',
        '    <testcase id="login" name="login" classname="login" time="3.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // Attempt 1: all passed across shards
      '/junit-reports/android-maestro-junit-attempt-1.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" device="emulator-5554" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="4.0" status="SUCCESS"/>',
        '  </testsuite>',
        '  <testsuite name="Test Suite" device="emulator-5556" tests="1" failures="0">',
        '    <testcase id="login" name="login" classname="login" time="2.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
      '/tests/2026-01-28_055420/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055420/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    const results = await parseMaestroResults('/junit-reports', '/tests', '/root/project');

    expect(results).toHaveLength(4);
    expect(results).toEqual([
      expect.objectContaining({ name: 'home', status: 'failed', retryCount: 0 }),
      expect.objectContaining({ name: 'home', status: 'passed', retryCount: 1 }),
      expect.objectContaining({ name: 'login', status: 'passed', retryCount: 0 }),
      expect.objectContaining({ name: 'login', status: 'passed', retryCount: 1 }),
    ]);
  });

  it('backward compat: reuse_devices=true with retries but old single JUnit file', async () => {
    vol.fromJSON({
      // Single overwritten JUnit (only has final attempt's results)
      '/maestro-tests/android-maestro-junit.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="2" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="4.0" status="SUCCESS"/>',
        '    <testcase id="login" name="login" classname="login" time="2.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // 2 timestamp dirs — both flows appear in both (entire suite retried)
      '/maestro-tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/maestro-tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
      '/maestro-tests/2026-01-28_055420/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/maestro-tests/2026-01-28_055420/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    const results = await parseMaestroResults('/maestro-tests', '/maestro-tests', '/root/project');

    // Both flows have 2 occurrences → retryCount = 1 for both
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'home', status: 'passed', retryCount: 1 }),
        expect.objectContaining({ name: 'login', status: 'passed', retryCount: 1 }),
      ])
    );
  });

  it('handles reuse_devices=false (separate junit_report_directory)', async () => {
    vol.fromJSON({
      // JUnit in temp dir (per-flow files)
      '/tmp/maestro-reports-abc123/junit-report-flow-1.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tmp/maestro-reports-abc123/junit-report-flow-2.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="1">',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="ERROR">',
        '      <failure>Failed</failure>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      // Debug output in default location
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/2026-01-28_055409/ai-login.json': JSON.stringify({
        flow_name: 'login',
        flow_file_path: '/root/project/.maestro/login.yml',
      }),
    });

    const results = await parseMaestroResults(
      '/tmp/maestro-reports-abc123',
      '/tests',
      '/root/project'
    );
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'home', path: '.maestro/home.yml', status: 'passed' }),
        expect.objectContaining({ name: 'login', path: '.maestro/login.yml', status: 'failed' }),
      ])
    );
  });

  it('uses raw path when flow_file_path is outside project_root', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/somewhere/else/.maestro/home.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    expect(results[0].path).toBe('/somewhere/else/.maestro/home.yml');
  });

  it('filters out non-timestamp directories when scanning debug output', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/tests/not-a-timestamp/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
    });

    const results = await parseMaestroResults('/junit', '/tests', '/root/project');
    // Only 1 occurrence (not-a-timestamp dir should be ignored)
    expect(results[0].retryCount).toBe(0);
  });
});

describe(parseJUnitTestCases, () => {
  it('parses a single testcase with SUCCESS status', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" device="emulator-5554" tests="1" failures="0" time="10.5">',
        '    <testcase id="home" name="home" classname="home" time="10.5" status="SUCCESS">',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results).toEqual([
      {
        name: 'home',
        status: 'passed',
        duration: 10500,
        errorMessage: null,
        tags: [],
        properties: {},
      },
    ]);
  });

  it('parses a failed testcase with failure message', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="1">',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="ERROR">',
        '      <failure>Element not visible</failure>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results).toEqual([
      {
        name: 'login',
        status: 'failed',
        duration: 5000,
        errorMessage: 'Element not visible',
        tags: [],
        properties: {},
      },
    ]);
  });

  it('extracts properties from testcase', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS">',
        '      <properties>',
        '        <property name="env" value="staging"/>',
        '        <property name="priority" value="high"/>',
        '      </properties>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].properties).toEqual({ env: 'staging', priority: 'high' });
  });

  it('extracts tags from "tags" property as comma-separated values', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS">',
        '      <properties>',
        '        <property name="tags" value="smoke, critical, auth"/>',
        '        <property name="priority" value="high"/>',
        '      </properties>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].tags).toEqual(['smoke', 'critical', 'auth']);
    expect(results[0].properties).toEqual({ priority: 'high' });
  });

  it('returns empty tags when no "tags" property exists (older Maestro)', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS">',
        '      <properties>',
        '        <property name="priority" value="high"/>',
        '      </properties>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].tags).toEqual([]);
    expect(results[0].properties).toEqual({ priority: 'high' });
  });

  it('parses multiple testcases across multiple testsuites (shards)', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" device="emulator-5554" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '  <testsuite name="Test Suite" device="emulator-5556" tests="1" failures="1">',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="ERROR">',
        '      <failure>Tap failed</failure>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'home', status: 'passed' }),
        expect.objectContaining({ name: 'login', status: 'failed', errorMessage: 'Tap failed' }),
      ])
    );
  });

  it('parses multiple JUnit XML files in the same directory', async () => {
    vol.fromJSON({
      '/junit/junit-report-flow-1.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/junit/junit-report-flow-2.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="1">',
        '    <testcase id="login" name="login" classname="login" time="5.0" status="ERROR">',
        '      <failure>Tap failed</failure>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results).toHaveLength(2);
  });

  it('handles missing time attribute (defaults to 0)', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].duration).toBe(0);
  });

  it('handles invalid time attribute (defaults to 0)', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="not_a_number" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].duration).toBe(0);
  });

  it('uses @_status attribute for pass/fail (not <failure> presence)', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="1">',
        '    <testcase id="home" name="home" classname="home" time="5.0" status="ERROR"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].status).toBe('failed');
    expect(results[0].errorMessage).toBeNull();
  });

  it('extracts error message from <error> element', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="1">',
        '    <testcase id="home" name="home" classname="home" time="5.0" status="ERROR">',
        '      <error>Runtime exception occurred</error>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].status).toBe('failed');
    expect(results[0].errorMessage).toBe('Runtime exception occurred');
  });

  it('returns empty array when directory does not exist', async () => {
    const results = await parseJUnitTestCases('/nonexistent');
    expect(results).toEqual([]);
  });

  it('returns empty array when no XML files found', async () => {
    vol.fromJSON({ '/junit/.gitkeep': '' });
    const results = await parseJUnitTestCases('/junit');
    expect(results).toEqual([]);
  });

  it('skips invalid XML files gracefully', async () => {
    vol.fromJSON({
      '/junit/bad.xml': 'not xml at all',
      '/junit/good.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results).toEqual([expect.objectContaining({ name: 'home', status: 'passed' })]);
  });

  it('handles testcase with no properties element', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS"/>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
    });

    const results = await parseJUnitTestCases('/junit');
    expect(results[0].properties).toEqual({});
  });
});

describe('parseFailedFlowsFromJUnit', () => {
  it('returns the subset of input flow paths whose testcases failed', async () => {
    // memfs setup: 3 input flows, 1 junit file with 1 failure, 1 timestamp dir with 3 ai-*.json
    vol.fromJSON({
      '/project/flows/login.yaml': '',
      '/project/flows/search.yaml': '',
      '/project/flows/checkout.yaml': '',
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites>
  <testsuite>
    <testcase name="Login" status="SUCCESS" time="1.0" />
    <testcase name="Search" status="SUCCESS" time="1.0" />
    <testcase name="Checkout" time="1.0"><failure>something</failure></testcase>
  </testsuite>
</testsuites>`,
      '/tmp/tests/2026-04-23_120000/ai-Login.json': JSON.stringify({
        flow_name: 'Login',
        flow_file_path: '/project/flows/login.yaml',
      }),
      '/tmp/tests/2026-04-23_120000/ai-Search.json': JSON.stringify({
        flow_name: 'Search',
        flow_file_path: '/project/flows/search.yaml',
      }),
      '/tmp/tests/2026-04-23_120000/ai-Checkout.json': JSON.stringify({
        flow_name: 'Checkout',
        flow_file_path: '/project/flows/checkout.yaml',
      }),
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/android-maestro-junit-attempt-0.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/login.yaml', 'flows/search.yaml', 'flows/checkout.yaml'],
      projectRoot: '/project',
    });

    expect(result).toEqual(['flows/checkout.yaml']);
  });

  it('accepts flow files discovered under a directory input (documented usage)', async () => {
    // Users may set `flow_path: ./maestro/flows` (a directory). Maestro then
    // discovers the YAMLs inside; smart retry must still subset to the failing
    // child file, not fall back to dumb retry.
    vol.fromJSON({
      '/project/flows/login.yaml': '',
      '/project/flows/checkout.yaml': '',
      '/tmp/junit-reports/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Login" status="SUCCESS" time="1.0" />
  <testcase name="Checkout" time="1.0"><failure>x</failure></testcase>
</testsuite></testsuites>`,
      '/tmp/tests/2026-04-23_120000/ai-Login.json': JSON.stringify({
        flow_name: 'Login',
        flow_file_path: '/project/flows/login.yaml',
      }),
      '/tmp/tests/2026-04-23_120000/ai-Checkout.json': JSON.stringify({
        flow_name: 'Checkout',
        flow_file_path: '/project/flows/checkout.yaml',
      }),
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/attempt-0.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows'],
      projectRoot: '/project',
    });

    expect(result).toEqual(['flows/checkout.yaml']);
  });

  it('returns null when two failing testcases share the same name (collision)', async () => {
    vol.fromJSON({
      '/project/flows/a.yaml': '',
      '/project/flows/b.yaml': '',
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Duplicate" time="1.0"><failure>x</failure></testcase>
  <testcase name="Duplicate" time="1.0"><failure>y</failure></testcase>
</testsuite></testsuites>`,
      '/tmp/tests/2026-04-23_120000/ai-Duplicate.json': JSON.stringify({
        flow_name: 'Duplicate',
        flow_file_path: '/project/flows/a.yaml',
      }),
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/android-maestro-junit-attempt-0.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/a.yaml', 'flows/b.yaml'],
      projectRoot: '/project',
    });

    expect(result).toBeNull();
  });

  it('returns null when a failing testcase shares a name with any other testcase (pass or fail)', async () => {
    vol.fromJSON({
      '/project/flows/a.yaml': '',
      '/project/flows/b.yaml': '',
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Shared" status="SUCCESS" time="1.0" />
  <testcase name="Shared" time="2.0"><failure>x</failure></testcase>
</testsuite></testsuites>`,
      '/tmp/tests/2026-04-23_120000/ai-Shared.json': JSON.stringify({
        flow_name: 'Shared',
        flow_file_path: '/project/flows/a.yaml',
      }),
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/android-maestro-junit-attempt-0.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/a.yaml', 'flows/b.yaml'],
      projectRoot: '/project',
    });

    expect(result).toBeNull();
  });

  it('returns null when junit file does not exist', async () => {
    vol.fromJSON({
      '/project/flows/a.yaml': '',
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/missing.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/a.yaml'],
      projectRoot: '/project',
    });
    expect(result).toBeNull();
  });

  it('returns null when junit file is malformed', async () => {
    vol.fromJSON({
      '/tmp/junit-reports/bad.xml': 'this is not xml',
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/bad.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/a.yaml'],
      projectRoot: '/project',
    });
    expect(result).toBeNull();
  });

  it('returns null when junit XML is truncated mid-tag (partial parse risk)', async () => {
    // fast-xml-parser can produce a partial parse from truncated XML — without
    // strict validation, smart retry would only retry the visible failures and
    // silently skip flows that were cut off, masking real failures when the
    // subset retry passes. Validation must reject the file → dumb retry.
    vol.fromJSON({
      '/project/flows/a.yaml': '',
      '/project/flows/b.yaml': '',
      '/tmp/junit-reports/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" time="1.0"><failure>x</failure></testcase>
  <testcase name="B"`, // intentionally truncated mid-tag
      '/tmp/tests/2026-04-23_120000/ai-A.json': JSON.stringify({
        flow_name: 'A',
        flow_file_path: '/project/flows/a.yaml',
      }),
      '/tmp/tests/2026-04-23_120000/ai-B.json': JSON.stringify({
        flow_name: 'B',
        flow_file_path: '/project/flows/b.yaml',
      }),
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/attempt-0.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/a.yaml', 'flows/b.yaml'],
      projectRoot: '/project',
    });
    expect(result).toBeNull();
  });

  it('returns null when junit XML has unclosed tags (partial parse risk)', async () => {
    vol.fromJSON({
      '/project/flows/a.yaml': '',
      '/tmp/junit-reports/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" time="1.0"><failure>x</failure></testcase>
</testsuite>`, // missing </testsuites>
      '/tmp/tests/2026-04-23_120000/ai-A.json': JSON.stringify({
        flow_name: 'A',
        flow_file_path: '/project/flows/a.yaml',
      }),
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/attempt-0.xml',
      testsDirectory: '/tmp/tests',
      inputFlowPaths: ['flows/a.yaml'],
      projectRoot: '/project',
    });
    expect(result).toBeNull();
  });
});

describe('mergeJUnitReports', () => {
  it('identity-copies a single attempt (preserves suite-level metadata)', async () => {
    // Single-attempt runs should land in final_report_path with the same
    // suite-level attributes (tests/failures/time) and non-testcase children
    // (e.g. <system-out>) that the legacy bash `cp` upload preserved. The
    // rebuild path used for multi-attempt merges drops these, so the single
    // case must short-circuit to a byte-equivalent copy.
    const input = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="Maestro Flows" tests="2" failures="0" time="3.0" device="Pixel 7">
    <testcase name="A" status="SUCCESS" time="1.0" />
    <testcase name="B" status="SUCCESS" time="2.0" />
    <system-out>boot complete</system-out>
  </testsuite>
</testsuites>`;
    vol.fromJSON({
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': input,
    });

    await mergeJUnitReports({
      sourceDir: '/tmp/junit-reports',
      outputPath: '/tmp/final.xml',
    });

    const out = await fs.readFile('/tmp/final.xml', 'utf-8');
    expect(out).toBe(input);
  });

  it('keeps the latest attempt per flow name across multiple files', async () => {
    vol.fromJSON({
      '/tmp/r/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" status="SUCCESS" time="1.0" />
  <testcase name="B" time="2.0"><failure>bad</failure></testcase>
</testsuite></testsuites>`,
      '/tmp/r/android-maestro-junit-attempt-1.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="B" status="SUCCESS" time="3.0" />
</testsuite></testsuites>`,
    });

    await mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' });

    const out = await fs.readFile('/tmp/final.xml', 'utf-8');
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(out);
    const testcases = parsed.testsuites.testsuite.testcase;
    const a = testcases.find((t: any) => t['@_name'] === 'A');
    const b = testcases.find((t: any) => t['@_name'] === 'B');
    expect(a['@_status']).toBe('SUCCESS'); // from attempt 0
    expect(b['@_status']).toBe('SUCCESS'); // from attempt 1 (latest)
    expect(b.failure).toBeUndefined();
  });

  it('throws when source directory contains no *.xml files', async () => {
    // No per-attempt JUnit files were ever written (maestro crashed before
    // producing output). Phase 3 in runMaestroTests treats this as a SystemError
    // — without a throw here, mergeJUnitReports would silently write an empty
    // <testsuite> and the caller would upload a misleading empty report.
    vol.fromJSON({
      '/tmp/r/.gitkeep': '',
    });

    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow(/no \*\.xml files/);
  });

  it('throws on invalid XML so caller can fall back to copyLatestAttemptXml', async () => {
    // Without a throw, mergeJUnitReports would silently emit an empty merged
    // document and the copy-latest fallback (which only triggers on throw)
    // would never run.
    vol.fromJSON({
      '/tmp/r/android-maestro-junit-attempt-0.xml': 'not xml at all',
    });

    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow(/invalid XML/);
  });

  it('throws when every input has <testsuites> but no <testcase> elements', async () => {
    vol.fromJSON({
      '/tmp/r/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite></testsuite></testsuites>`,
    });

    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow(/no parseable testcases/);
  });

  it('throws when any input XML is malformed (even if others parse)', async () => {
    vol.fromJSON({
      '/tmp/r/attempt-0.xml': `<?xml version="1.0"?><testsuites><testsuite><testcase name="A" status="SUCCESS" time="1.0"/></testsuite></testsuites>`,
      '/tmp/r/attempt-1.xml': 'garbage not xml',
    });
    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow();
  });

  it('throws when an input XML is truncated mid-tag (would otherwise partial-parse)', async () => {
    // fast-xml-parser is lenient and can return partial results from truncated
    // XML. Without strict validation, mergeJUnitReports would emit a merged
    // report missing the cut-off flows and Phase 3's copy-latest fallback
    // would never run. Validation must reject the file.
    vol.fromJSON({
      '/tmp/r/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" status="SUCCESS" time="1.0"/>
  <testcase name="B"`, // truncated mid-tag
    });
    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow();
  });

  it('throws when an input XML has unclosed tags (would otherwise partial-parse)', async () => {
    vol.fromJSON({
      '/tmp/r/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" status="SUCCESS" time="1.0"/>
</testsuite>`, // missing </testsuites>
    });
    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow();
  });

  it('throws when any input XML parses but has no testcases (even if others have testcases)', async () => {
    vol.fromJSON({
      '/tmp/r/attempt-0.xml': `<?xml version="1.0"?><testsuites><testsuite><testcase name="A" status="SUCCESS" time="1.0"/></testsuite></testsuites>`,
      '/tmp/r/attempt-1.xml': `<?xml version="1.0"?><testsuites></testsuites>`,
    });
    await expect(
      mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' })
    ).rejects.toThrow();
  });

  it('preserves duplicate names within the same attempt', async () => {
    vol.fromJSON({
      '/tmp/r/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Dup" status="SUCCESS" time="1.0" />
  <testcase name="Dup" status="SUCCESS" time="2.0" />
</testsuite></testsuites>`,
    });

    await mergeJUnitReports({ sourceDir: '/tmp/r', outputPath: '/tmp/final.xml' });

    const out = await fs.readFile('/tmp/final.xml', 'utf-8');
    const parsed = new XMLParser({ ignoreAttributes: false, isArray: n => n === 'testcase' }).parse(
      out
    );
    expect(parsed.testsuites.testsuite.testcase).toHaveLength(2);
  });
});

describe('copyLatestAttemptXml', () => {
  it('picks the highest attempt number', async () => {
    vol.fromJSON({
      '/tmp/r/android-maestro-junit-attempt-0.xml': '<a/>',
      '/tmp/r/android-maestro-junit-attempt-1.xml': '<b/>',
      '/tmp/r/android-maestro-junit-attempt-2.xml': '<c/>',
    });
    await copyLatestAttemptXml({ sourceDir: '/tmp/r', outputPath: '/tmp/out.xml' });
    expect(await fs.readFile('/tmp/out.xml', 'utf-8')).toBe('<c/>');
  });

  it('throws when source has no xml files', async () => {
    vol.fromJSON({ '/tmp/r/.keep': '' });
    await expect(
      copyLatestAttemptXml({ sourceDir: '/tmp/r', outputPath: '/tmp/out.xml' })
    ).rejects.toThrow();
  });
});
