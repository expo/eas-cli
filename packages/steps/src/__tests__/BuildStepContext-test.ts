import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

import { JobInterpolationContext } from '@expo/eas-build-job';
import { instance, mock, when } from 'ts-mockito';

import { BuildStep } from '../BuildStep.js';
import { BuildStepGlobalContext, BuildStepContext } from '../BuildStepContext.js';
import { BuildStepRuntimeError } from '../errors.js';
import { BuildRuntimePlatform } from '../BuildRuntimePlatform.js';

import { createGlobalContextMock, MockContextProvider } from './utils/context.js';
import { getError } from './utils/error.js';
import { createMockLogger } from './utils/logger.js';

describe(BuildStepGlobalContext, () => {
  describe('stepsInternalBuildDirectory', () => {
    it('is in os.tmpdir()', () => {
      const ctx = new BuildStepGlobalContext(
        new MockContextProvider(
          createMockLogger(),
          BuildRuntimePlatform.LINUX,
          '/non/existent/path',
          '/another/non/existent/path',
          '/working/dir/path',
          '/non/existent/path',
          {} as unknown as JobInterpolationContext
        ),
        false
      );
      expect(ctx.stepsInternalBuildDirectory.startsWith(os.tmpdir())).toBe(true);
    });
  });
  describe('workingDirectory', () => {
    it('if not checked out uses project target dir as default working dir', () => {
      const workingDirectory = '/path/to/working/dir';
      const projectTargetDirectory = '/another/non/existent/path';
      const ctx = new BuildStepGlobalContext(
        new MockContextProvider(
          createMockLogger(),
          BuildRuntimePlatform.LINUX,
          '/non/existent/path',
          projectTargetDirectory,
          workingDirectory,
          '/non/existent/path',
          {} as unknown as JobInterpolationContext
        ),
        false
      );
      expect(ctx.defaultWorkingDirectory).toBe(projectTargetDirectory);
    });

    it('if checked out uses default working dir as default working dir', () => {
      const workingDirectory = '/path/to/working/dir';
      const projectTargetDirectory = '/another/non/existent/path';
      const ctx = new BuildStepGlobalContext(
        new MockContextProvider(
          createMockLogger(),
          BuildRuntimePlatform.LINUX,
          '/non/existent/path',
          projectTargetDirectory,
          workingDirectory,
          '/non/existent/path',
          {} as unknown as JobInterpolationContext
        ),
        false
      );
      ctx.markAsCheckedOut(ctx.baseLogger);
      expect(ctx.defaultWorkingDirectory).toBe(workingDirectory);
    });
  });
  describe(BuildStepGlobalContext.prototype.registerStep, () => {
    it('exists', () => {
      const ctx = createGlobalContextMock();
      expect(typeof ctx.registerStep).toBe('function');
    });
  });
  describe(BuildStepGlobalContext.prototype.serialize, () => {
    it('serializes global context', () => {
      const ctx = createGlobalContextMock({
        skipCleanup: true,
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        projectSourceDirectory: '/a/b/c',
        projectTargetDirectory: '/d/e/f',
        relativeWorkingDirectory: 'i',
        staticContextContent: { a: 1 } as unknown as JobInterpolationContext,
      });
      expect(ctx.serialize()).toEqual(
        expect.objectContaining({
          stepsInternalBuildDirectory: ctx.stepsInternalBuildDirectory,
          stepById: {},
          provider: {
            projectSourceDirectory: '/a/b/c',
            projectTargetDirectory: '/d/e/f',
            defaultWorkingDirectory: '/d/e/f/i',
            buildLogsDirectory: '/non/existent/dir',
            runtimePlatform: BuildRuntimePlatform.DARWIN,
            staticContext: { a: 1 },
            env: {},
          },
          skipCleanup: true,
        })
      );
    });
  });
  describe(BuildStepGlobalContext.deserialize, () => {
    it('deserializes global context', () => {
      const ctx = BuildStepGlobalContext.deserialize(
        {
          stepsInternalBuildDirectory: '/m/n/o',
          stepById: {
            build_ios: {
              id: 'build_ios',
              executed: true,
              outputById: {
                build_id: {
                  id: 'build_id',
                  stepDisplayName: 'build_ios',
                  required: true,
                  value: 'build_id_value',
                },
              },
              displayName: 'build_ios',
            },
          },
          provider: {
            projectSourceDirectory: '/a/b/c',
            projectTargetDirectory: '/d/e/f',
            defaultWorkingDirectory: '/g/h/i',
            buildLogsDirectory: '/j/k/l',
            runtimePlatform: BuildRuntimePlatform.DARWIN,
            staticContext: { a: 1 } as unknown as JobInterpolationContext,
            env: {},
          },
          skipCleanup: true,
        },
        createMockLogger()
      );
      ctx.markAsCheckedOut(ctx.baseLogger);
      expect(ctx.stepsInternalBuildDirectory).toBe('/m/n/o');
      expect(ctx.defaultWorkingDirectory).toBe('/g/h/i');
      expect(ctx.runtimePlatform).toBe(BuildRuntimePlatform.DARWIN);
      expect(ctx.skipCleanup).toBe(true);
      expect(ctx.projectSourceDirectory).toBe('/a/b/c');
      expect(ctx.projectTargetDirectory).toBe('/d/e/f');
      expect(ctx.buildLogsDirectory).toBe('/j/k/l');
      expect(ctx.staticContext).toEqual({
        a: 1,
        steps: {
          build_ios: {
            outputs: {
              build_id: 'build_id_value',
            },
          },
        },
      });
      expect(ctx.env).toEqual({});
      expect(ctx.skipCleanup).toBe(true);
    });
  });
  describe(BuildStepGlobalContext.prototype.getStepOutputValue, () => {
    it('throws an error if the step output references a non-existent step', () => {
      const ctx = createGlobalContextMock();
      const error = getError<BuildStepRuntimeError>(() => {
        ctx.getStepOutputValue('steps.abc.def');
      });
      expect(error).toBeInstanceOf(BuildStepRuntimeError);
      expect(error.message).toMatch(/Step "abc" does not exist/);
    });
    it('calls getOutputValueByName on the step to get the output value', () => {
      const ctx = createGlobalContextMock();

      const mockStep = mock<BuildStep>();
      when(mockStep.id).thenReturn('abc');
      when(mockStep.getOutputValueByName('def')).thenReturn('ghi');
      const step = instance(mockStep);

      ctx.registerStep(step);
      expect(ctx.getStepOutputValue('steps.abc.def')).toBe('ghi');
    });
  });
  describe(BuildStepGlobalContext.prototype.stepCtx, () => {
    it('returns a BuildStepContext object', () => {
      const ctx = createGlobalContextMock();
      expect(ctx.stepCtx({ logger: ctx.baseLogger })).toBeInstanceOf(BuildStepContext);
    });
    it('can override logger', () => {
      const logger1 = createMockLogger();
      const logger2 = createMockLogger();
      const ctx = createGlobalContextMock({ logger: logger1 });
      const childCtx = ctx.stepCtx({
        logger: logger2,
      });
      expect(ctx.baseLogger).toBe(logger1);
      expect(childCtx.logger).toBe(logger2);
    });
    it('can override working directory', () => {
      const ctx = createGlobalContextMock({
        relativeWorkingDirectory: 'apps/mobile',
      });
      ctx.markAsCheckedOut(ctx.baseLogger);

      const relativeChildCtx = ctx.stepCtx({
        relativeWorkingDirectory: 'scripts',
        logger: ctx.baseLogger,
      });
      expect(ctx.defaultWorkingDirectory).not.toBe(relativeChildCtx.workingDirectory);
      expect(relativeChildCtx.workingDirectory).toBe(
        path.join(ctx.projectTargetDirectory, 'apps/mobile/scripts')
      );

      const absoluteChildCtx = ctx.stepCtx({
        relativeWorkingDirectory: '/apps/web',
        logger: ctx.baseLogger,
      });
      expect(ctx.defaultWorkingDirectory).not.toBe(absoluteChildCtx.workingDirectory);
      expect(absoluteChildCtx.workingDirectory).toBe(
        path.join(ctx.projectTargetDirectory, 'apps/web')
      );
    });
  });
  describe(BuildStepGlobalContext.prototype.hashFiles, () => {
    let tempDir: string;
    let ctx: BuildStepGlobalContext;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashfiles-test-'));
      ctx = createGlobalContextMock({
        projectTargetDirectory: tempDir,
        relativeWorkingDirectory: '',
      });
      ctx.markAsCheckedOut(ctx.baseLogger);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns empty string when no files match', () => {
      const hash = ctx.hashFiles('nonexistent/**/*.txt');
      expect(hash).toBe('');
    });

    it('hashes a single file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'test content');

      const hash = ctx.hashFiles('test.txt');

      // Verify it matches the expected hash format
      const expectedHash = crypto.createHash('sha256');
      const fileHash = crypto.createHash('sha256');
      fileHash.update('test content');
      expectedHash.write(fileHash.digest());
      expectedHash.end();

      expect(hash).toBe(expectedHash.digest('hex'));
    });

    it('hashes multiple files in deterministic order', () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2');
      fs.writeFileSync(path.join(tempDir, 'file3.txt'), 'content3');

      const hash1 = ctx.hashFiles('*.txt');
      const hash2 = ctx.hashFiles('*.txt');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe('');
    });

    it('produces different hashes for different file contents', () => {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content1');
      const hash1 = ctx.hashFiles('file.txt');

      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content2');
      const hash2 = ctx.hashFiles('file.txt');

      expect(hash1).not.toBe(hash2);
    });

    it('works with glob patterns', () => {
      const subdir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(tempDir, 'file1.js'), 'code1');
      fs.writeFileSync(path.join(subdir, 'file2.js'), 'code2');
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'text');

      const hash = ctx.hashFiles('**/*.js');
      expect(hash).not.toBe('');
    });

    it('skips files outside workspace', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      try {
        fs.writeFileSync(path.join(outsideDir, 'outside.txt'), 'outside');
        fs.writeFileSync(path.join(tempDir, 'inside.txt'), 'inside');

        // This pattern won't match outside files due to glob cwd
        const hash = ctx.hashFiles('inside.txt');
        expect(hash).not.toBe('');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('handles empty files', () => {
      fs.writeFileSync(path.join(tempDir, 'empty.txt'), '');
      const hash = ctx.hashFiles('empty.txt');

      // Should still produce a hash for an empty file
      const expectedHash = crypto.createHash('sha256');
      const fileHash = crypto.createHash('sha256');
      fileHash.update('');
      expectedHash.write(fileHash.digest());
      expectedHash.end();

      expect(hash).toBe(expectedHash.digest('hex'));
    });

    it('supports multiple patterns', () => {
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), 'npm content');
      fs.writeFileSync(path.join(tempDir, 'Gemfile.lock'), 'ruby content');
      fs.writeFileSync(path.join(tempDir, 'other.txt'), 'other');

      const hash = ctx.hashFiles('**/package-lock.json', '**/Gemfile.lock');
      expect(hash).not.toBe('');

      // Verify the hash is deterministic
      const hash2 = ctx.hashFiles('**/package-lock.json', '**/Gemfile.lock');
      expect(hash).toBe(hash2);
    });

    it('supports exclusion patterns with multiple patterns', () => {
      const libDir = path.join(tempDir, 'lib');
      const fooDir = path.join(libDir, 'foo');
      fs.mkdirSync(libDir);
      fs.mkdirSync(fooDir);

      fs.writeFileSync(path.join(libDir, 'file1.rb'), 'ruby1');
      fs.writeFileSync(path.join(fooDir, 'file2.rb'), 'ruby2');

      const hashAll = ctx.hashFiles('lib/**/*.rb');
      const hashExcluded = ctx.hashFiles('lib/**/*.rb', '!lib/foo/*.rb');

      // The hashes should be different because exclusion removes foo/file2.rb
      expect(hashAll).not.toBe(hashExcluded);
      expect(hashExcluded).not.toBe('');
    });
  });
});
