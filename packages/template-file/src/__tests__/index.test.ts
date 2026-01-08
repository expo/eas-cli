import os from 'os';
import path from 'path';
import fs from 'fs/promises';

import { templateFile, templateString } from '../index';

const templatePath = path.join(__dirname, 'example.json.template');

describe('templateFile', () => {
  const outputFile = path.join(os.tmpdir(), 'output.json');

  afterEach(async () => {
    await fs.rm(outputFile, { force: true });
  });

  it('should create an output file with the filled-out template', async () => {
    await templateFile(templatePath, { SOME_KEY: 123, ANOTHER_KEY: 456 }, outputFile);
    const outputFileContents = await fs.readFile(outputFile, 'utf8');
    const outputFileJson = JSON.parse(outputFileContents);
    expect(outputFileJson).toEqual({ someKey: 123, anotherKey: 456 });
  });

  it('should throw an error if some variables are missing', async () => {
    const templateFilePromise = templateFile(templatePath, {}, outputFile);
    await expect(templateFilePromise).rejects.toThrow(/is not defined/);
  });
});

describe('templateString', () => {
  it('should interpolate variables using mustache syntax by default', () => {
    const input = 'Hello {{ name }}!';
    const result = templateString({ input, vars: { name: 'World' } });
    expect(result).toBe('Hello World!');
  });

  it('should interpolate variables using lodash syntax when mustache is false', () => {
    const input = 'Hello <%= name %>!';
    const result = templateString({ input, vars: { name: 'World' }, mustache: false });
    expect(result).toBe('Hello World!');
  });

  it('should handle missing variables by throwing an error', () => {
    const input = 'Hello {{ name }}!';
    expect(() => templateString({ input, vars: {} })).toThrow(/name is not defined/);
  });

  it('should interpolate multiple variables', () => {
    const input = '{{ greeting }} {{ name }}!';
    const result = templateString({ input, vars: { greeting: 'Hello', name: 'World' } });
    expect(result).toBe('Hello World!');
  });

  it('should handle complex objects in variables', () => {
    const input = 'Hello {{ user.name }}!';
    const result = templateString({ input, vars: { user: { name: 'World' } } });
    expect(result).toBe('Hello World!');
  });
});
