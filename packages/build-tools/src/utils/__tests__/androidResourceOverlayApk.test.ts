import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../__tests__/utils/logger';
import {
  buildAndroidResourceOverlayApkAsync,
  compareVersionsDescending,
  createOverlayManifest,
  createValuesXml,
} from '../androidResourceOverlayApk';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

describe(createValuesXml, () => {
  it('writes dimensions and escapes strings', () => {
    expect(
      createValuesXml([
        { type: 'dimen', name: 'status_bar_height_portrait', value: '66dp' },
        { type: 'string', name: 'path', value: 'm 0,0 h 1 <z> & "q" it\'s' },
        { type: 'string', name: 'reference_like', value: '@left' },
      ])
    ).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        '    <dimen name="status_bar_height_portrait">66dp</dimen>',
        '    <string name="path" translatable="false">m 0,0 h 1 &lt;z&gt; &amp; \\"q\\" it\\\'s</string>',
        '    <string name="reference_like" translatable="false">\\@left</string>',
        '</resources>',
        '',
      ].join('\n')
    );
  });
});

describe(createOverlayManifest, () => {
  it('declares a code-free overlay for the target package in its own category', () => {
    const manifest = createOverlayManifest({
      packageName: 'expo.eas.emulator.profile.pixel_9.framework',
      targetPackage: 'android',
      category: 'expo.eas.emulator.profile',
    });
    expect(manifest).toContain('package="expo.eas.emulator.profile.pixel_9.framework"');
    expect(manifest).toContain('<application android:hasCode="false" />');
    expect(manifest).toContain(
      '<overlay android:targetPackage="android" android:category="expo.eas.emulator.profile" />'
    );
  });
});

describe(compareVersionsDescending, () => {
  it('sorts versions from newest to oldest', () => {
    expect(
      ['35.0.0', '36.1.0', '36.0.0', '9.0.0', 'debian'].sort(compareVersionsDescending)
    ).toEqual(['36.1.0', '36.0.0', '35.0.0', '9.0.0', 'debian']);
  });
});

describe(buildAndroidResourceOverlayApkAsync, () => {
  let androidHome: string;
  let workingDirectory: string;

  beforeEach(async () => {
    androidHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'overlay-sdk-'));
    workingDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'overlay-work-'));
    for (const version of ['35.0.0', '36.0.0']) {
      await fs.promises.mkdir(path.join(androidHome, 'build-tools', version), { recursive: true });
      await fs.promises.writeFile(path.join(androidHome, 'build-tools', version, 'aapt2'), '');
    }
    for (const platform of ['android-35', 'android-36']) {
      await fs.promises.mkdir(path.join(androidHome, 'platforms', platform), { recursive: true });
      await fs.promises.writeFile(path.join(androidHome, 'platforms', platform, 'android.jar'), '');
    }
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  afterEach(async () => {
    await fs.promises.rm(androidHome, { recursive: true, force: true });
    await fs.promises.rm(workingDirectory, { recursive: true, force: true });
  });

  it('compiles, links, aligns, and signs the overlay with the newest SDK tools', async () => {
    const apkPath = await buildAndroidResourceOverlayApkAsync({
      packageName: 'expo.eas.emulator.profile.pixel_9.framework',
      targetPackage: 'android',
      category: 'expo.eas.emulator.profile',
      values: [{ type: 'dimen', name: 'status_bar_height_portrait', value: '66dp' }],
      workingDirectory,
      env: { ANDROID_HOME: androidHome, JAVA_HOME: '/jdk' },
      logger: createMockLogger(),
    });

    const buildTools = path.join(androidHome, 'build-tools', '36.0.0');
    const projectDirectory = path.join(
      workingDirectory,
      'expo.eas.emulator.profile.pixel_9.framework'
    );
    expect(apkPath).toBe(
      path.join(workingDirectory, 'expo.eas.emulator.profile.pixel_9.framework.apk')
    );
    expect(mockedSpawn.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
      [path.join(buildTools, 'aapt2'), 'compile'],
      [path.join(buildTools, 'aapt2'), 'link'],
      [path.join(buildTools, 'zipalign'), '-f'],
      ['/jdk/bin/keytool', '-genkeypair'],
      [path.join(buildTools, 'apksigner'), 'sign'],
    ]);
    expect(mockedSpawn.mock.calls[1][1]).toEqual(
      expect.arrayContaining([
        '-I',
        path.join(androidHome, 'platforms', 'android-36', 'android.jar'),
        '--target-sdk-version',
        '36',
      ])
    );
    await expect(
      fs.promises.readFile(path.join(projectDirectory, 'res', 'values', 'values.xml'), 'utf-8')
    ).resolves.toContain('<dimen name="status_bar_height_portrait">66dp</dimen>');
  });

  it('fails without an Android platform', async () => {
    await fs.promises.rm(path.join(androidHome, 'platforms'), { recursive: true });

    await expect(
      buildAndroidResourceOverlayApkAsync({
        packageName: 'expo.eas.emulator.profile.pixel_9.framework',
        targetPackage: 'android',
        category: 'expo.eas.emulator.profile',
        values: [],
        workingDirectory,
        env: { ANDROID_HOME: androidHome },
        logger: createMockLogger(),
      })
    ).rejects.toThrow('No Android platform with android.jar');
  });
});
