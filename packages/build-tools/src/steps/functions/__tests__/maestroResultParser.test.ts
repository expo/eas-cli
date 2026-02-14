import { vol } from 'memfs';

import {
  parseFlowMetadata,
  parseFlowTags,
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
      flowName: 'home',
      flowFilePath: '/Users/expo/workingdir/build/.maestro/home.yml',
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

describe(parseFlowTags, () => {
  it('extracts tags from flow YAML config section', async () => {
    vol.fromJSON({
      '/flows/home.yml': [
        'appId: com.example.app',
        'tags:',
        '  - e2e',
        '  - smoke',
        '---',
        '- launchApp',
      ].join('\n'),
    });

    const tags = await parseFlowTags('/flows/home.yml');
    expect(tags).toEqual(['e2e', 'smoke']);
  });

  it('returns empty array when no tags field', async () => {
    vol.fromJSON({
      '/flows/home.yml': ['appId: com.example.app', '---', '- launchApp'].join('\n'),
    });

    const tags = await parseFlowTags('/flows/home.yml');
    expect(tags).toEqual([]);
  });

  it('returns empty array when file does not exist', async () => {
    const tags = await parseFlowTags('/nonexistent/home.yml');
    expect(tags).toEqual([]);
  });

  it('filters out non-string tags', async () => {
    vol.fromJSON({
      '/flows/home.yml': [
        'appId: com.example.app',
        'tags:',
        '  - e2e',
        '  - 123',
        '---',
        '- launchApp',
      ].join('\n'),
    });

    const tags = await parseFlowTags('/flows/home.yml');
    expect(tags).toEqual(['e2e']);
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

  it('extracts tags from flow YAML and properties from JUnit', async () => {
    vol.fromJSON({
      '/junit/report.xml': [
        '<?xml version="1.0"?>',
        '<testsuites>',
        '  <testsuite name="Test Suite" tests="1" failures="0">',
        '    <testcase id="home" name="home" classname="home" time="10.0" status="SUCCESS">',
        '      <properties>',
        '        <property name="env" value="staging"/>',
        '      </properties>',
        '    </testcase>',
        '  </testsuite>',
        '</testsuites>',
      ].join('\n'),
      '/tests/2026-01-28_055409/ai-home.json': JSON.stringify({
        flow_name: 'home',
        flow_file_path: '/root/project/.maestro/home.yml',
      }),
      '/root/project/.maestro/home.yml': [
        'appId: com.example.app',
        'tags:',
        '  - e2e',
        '  - smoke',
        '---',
        '- launchApp',
      ].join('\n'),
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
