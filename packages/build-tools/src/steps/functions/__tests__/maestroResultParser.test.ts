import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import { vol } from 'memfs';

import {
  copyLatestAttemptXml,
  mergeJUnitReports,
  parseFailedFlowsFromJUnit,
  parseJUnitTestCases,
  parseMaestroResults,
} from '../maestroResultParser';

describe(parseMaestroResults, () => {
  it('parses JUnit results and enriches with name→path map', async () => {
    vol.fromJSON({
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
    });

    const results = await parseMaestroResults(
      '/junit',
      new Map([
        ['home', '.maestro/home.yml'],
        ['login', '.maestro/login.yml'],
      ])
    );
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

  it('uses flow name as fallback path when nameToPath is null', async () => {
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

    const results = await parseMaestroResults('/junit', null);
    expect(results[0].path).toBe('home');
    expect(results[0].retryCount).toBe(0);
  });

  it('uses flow name as fallback path when name not in map', async () => {
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

    const results = await parseMaestroResults('/junit', new Map());
    expect(results[0].path).toBe('home');
  });

  it('returns empty array when no JUnit files found', async () => {
    vol.fromJSON({ '/junit/.gitkeep': '' });

    const results = await parseMaestroResults('/junit', new Map([['home', '.maestro/home.yml']]));
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
    });

    const results = await parseMaestroResults('/junit', new Map([['home', '.maestro/home.yml']]));
    expect(results[0].tags).toEqual(['e2e', 'smoke']);
    expect(results[0].properties).toEqual({ env: 'staging' });
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
    });

    const results = await parseMaestroResults('/junit', new Map([['login', '.maestro/login.yml']]));

    // Should return 2 results — one per attempt; retryCount from filename
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
    });

    const results = await parseMaestroResults(
      '/junit-reports',
      new Map([
        ['home', '.maestro/home.yml'],
        ['login', '.maestro/login.yml'],
      ])
    );

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
    });

    const results = await parseMaestroResults(
      '/junit-reports',
      new Map([
        ['home', '.maestro/home.yml'],
        ['login', '.maestro/login.yml'],
      ])
    );

    expect(results).toHaveLength(4);
    expect(results).toEqual([
      expect.objectContaining({ name: 'home', status: 'failed', retryCount: 0 }),
      expect.objectContaining({ name: 'home', status: 'passed', retryCount: 1 }),
      expect.objectContaining({ name: 'login', status: 'passed', retryCount: 0 }),
      expect.objectContaining({ name: 'login', status: 'passed', retryCount: 1 }),
    ]);
  });

  it('handles reuse_devices=false (separate junit_report_directory, per-flow files)', async () => {
    vol.fromJSON({
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
    });

    const results = await parseMaestroResults(
      '/tmp/maestro-reports-abc123',
      new Map([
        ['home', '.maestro/home.yml'],
        ['login', '.maestro/login.yml'],
      ])
    );
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'home', path: '.maestro/home.yml', status: 'passed' }),
        expect.objectContaining({ name: 'login', path: '.maestro/login.yml', status: 'failed' }),
      ])
    );
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
    vol.fromJSON({
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites>
  <testsuite>
    <testcase name="Login" status="SUCCESS" time="1.0" />
    <testcase name="Search" status="SUCCESS" time="1.0" />
    <testcase name="Checkout" time="1.0"><failure>something</failure></testcase>
  </testsuite>
</testsuites>`,
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/android-maestro-junit-attempt-0.xml',
      nameToPath: new Map([
        ['Login', 'flows/login.yaml'],
        ['Search', 'flows/search.yaml'],
        ['Checkout', 'flows/checkout.yaml'],
      ]),
    });

    expect(result).toEqual(['flows/checkout.yaml']);
  });

  it('returns null when a failing testcase has no entry in nameToPath', async () => {
    vol.fromJSON({
      '/tmp/junit-reports/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Login" status="SUCCESS" time="1.0" />
  <testcase name="Unknown" time="1.0"><failure>x</failure></testcase>
</testsuite></testsuites>`,
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/attempt-0.xml',
      nameToPath: new Map([['Login', 'flows/login.yaml']]),
    });

    expect(result).toBeNull();
  });

  it('returns null when two failing testcases share the same name (collision)', async () => {
    vol.fromJSON({
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Duplicate" time="1.0"><failure>x</failure></testcase>
  <testcase name="Duplicate" time="1.0"><failure>y</failure></testcase>
</testsuite></testsuites>`,
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/android-maestro-junit-attempt-0.xml',
      nameToPath: new Map([['Duplicate', 'flows/a.yaml']]),
    });

    expect(result).toBeNull();
  });

  it('returns null when a failing testcase shares a name with any other testcase (pass or fail)', async () => {
    vol.fromJSON({
      '/tmp/junit-reports/android-maestro-junit-attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="Shared" status="SUCCESS" time="1.0" />
  <testcase name="Shared" time="2.0"><failure>x</failure></testcase>
</testsuite></testsuites>`,
    });

    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/android-maestro-junit-attempt-0.xml',
      nameToPath: new Map([['Shared', 'flows/a.yaml']]),
    });

    expect(result).toBeNull();
  });

  it('returns null when junit file does not exist', async () => {
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/missing.xml',
      nameToPath: new Map([['A', 'flows/a.yaml']]),
    });
    expect(result).toBeNull();
  });

  it('returns null when junit file is malformed', async () => {
    vol.fromJSON({
      '/tmp/junit-reports/bad.xml': 'this is not xml',
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/bad.xml',
      nameToPath: new Map([['A', 'flows/a.yaml']]),
    });
    expect(result).toBeNull();
  });

  it('returns null when junit XML is truncated mid-tag (partial parse risk)', async () => {
    // fast-xml-parser can produce a partial parse from truncated XML — without
    // strict validation, smart retry would only retry the visible failures and
    // silently skip flows that were cut off.
    vol.fromJSON({
      '/tmp/junit-reports/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" time="1.0"><failure>x</failure></testcase>
  <testcase name="B"`, // intentionally truncated mid-tag
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/attempt-0.xml',
      nameToPath: new Map([
        ['A', 'flows/a.yaml'],
        ['B', 'flows/b.yaml'],
      ]),
    });
    expect(result).toBeNull();
  });

  it('returns null when junit XML has unclosed tags (partial parse risk)', async () => {
    vol.fromJSON({
      '/tmp/junit-reports/attempt-0.xml': `<?xml version="1.0"?>
<testsuites><testsuite>
  <testcase name="A" time="1.0"><failure>x</failure></testcase>
</testsuite>`, // missing </testsuites>
    });
    const result = await parseFailedFlowsFromJUnit({
      junitFile: '/tmp/junit-reports/attempt-0.xml',
      nameToPath: new Map([['A', 'flows/a.yaml']]),
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
