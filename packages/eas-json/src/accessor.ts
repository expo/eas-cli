import { codeFrameColumns } from '@babel/code-frame';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import * as fleece from 'golden-fleece';
import { ValidationError } from 'joi';
import path from 'path';

import { InvalidEasJsonError, MissingEasJsonError } from './errors';
import { link } from './log';
import { EasJsonSchema } from './schema';
import { EasJson } from './types';

const customErrorMessageHandlers: ((err: ValidationError) => void)[] = [
  // Ask user to upgrade eas-cli version or check the docs when image is invalid.
  (err: ValidationError) => {
    for (const detail of err.details) {
      // image should be only placed under 'build.profilename.platform.image' key
      // if it's not the case show standard Joi error
      if (
        detail.path.length === 4 &&
        detail.path[0] === 'build' &&
        ['ios', 'android'].includes(detail.path[2].toString()) &&
        detail.path[3] === 'image'
      ) {
        throw new InvalidEasJsonError(
          chalk.red(
            `Specified build image '${detail?.context}' is not recognized. Please update your EAS CLI and see ${link(
              'https://docs.expo.dev/build-reference/infrastructure/'
            )} for supported build images.`
          )
        );
      }
    }
  },
];

export class EasJsonAccessor {
  private easJsonPath: string | undefined;

  private isJson5 = false;
  private easJson: EasJson | undefined;
  private easJsonRawContents: string | undefined;
  private easJsonRawObject: any | undefined;
  private easJsonPatched: boolean = false;

  private constructor({ projectDir }: { projectDir: string });
  private constructor({ easJsonRawContents }: { easJsonRawContents: string });
  private constructor({
    projectDir,
    easJsonRawContents,
  }: {
    projectDir?: string;
    easJsonRawContents?: string;
  }) {
    this.easJsonPath = projectDir && EasJsonAccessor.formatEasJsonPath(projectDir);
    this.easJsonRawContents = easJsonRawContents;
  }

  public static fromProjectPath(projectDir: string): EasJsonAccessor {
    return new EasJsonAccessor({ projectDir });
  }

  public static fromRawString(easJsonRawContents: string): EasJsonAccessor {
    return new EasJsonAccessor({ easJsonRawContents });
  }

  public static formatEasJsonPath(projectDir: string): string {
    return path.join(projectDir, 'eas.json');
  }

  public async readAsync(): Promise<EasJson> {
    if (this.easJson) {
      return this.easJson;
    }

    const rawJSON = await this.readRawJsonAsync();
    const { value, error } = EasJsonSchema.validate(rawJSON, {
      allowUnknown: false,
      abortEarly: false,
      convert: true,
      noDefaults: true,
    });
    if (error) {
      for (const handler of customErrorMessageHandlers) {
        handler(error);
      }

      const errorMessages = error.message.split('. ');
      throw new InvalidEasJsonError(
        `${chalk.bold('eas.json')} is not valid.\n- ${errorMessages.join('\n- ')}`
      );
    }
    this.easJson = value;
    return value;
  }

  public async writeAsync(): Promise<void> {
    if (!this.easJsonPath) {
      throw new Error('Updates are not supported for EasJsonAccessor created from string.');
    }
    if (!this.easJsonPatched || !this.easJsonRawContents) {
      return;
    }
    await fs.writeFile(this.easJsonPath, this.easJsonRawContents);
    this.resetState();
  }

  public patch(fn: (easJsonRawObject: any) => any): void {
    if (!this.easJsonPath) {
      throw new Error('Updates are not supported for EasJsonAccessor created from string.');
    }
    assert(
      this.easJsonRawContents && this.easJsonRawObject,
      'call readAsync/readRawJsonAsync first'
    );

    this.easJsonRawObject = fn(this.easJsonRawObject);
    if (this.isJson5) {
      this.easJsonRawContents = fleece.patch(this.easJsonRawContents, this.easJsonRawObject);
    } else {
      this.easJsonRawContents = `${JSON.stringify(this.easJsonRawObject, null, 2)}\n`;
    }
    this.easJsonPatched = true;
  }

  public async readRawJsonAsync(): Promise<any> {
    if (this.easJsonPath) {
      if (!(await fs.pathExists(this.easJsonPath))) {
        throw new MissingEasJsonError(
          `${chalk.bold('eas.json')} could not be found at ${
            this.easJsonPath
          }. Learn more at https://expo.fyi/eas-json`
        );
      }
      this.easJsonRawContents = await fs.readFile(this.easJsonPath, 'utf-8');
    }
    return this.parseRawJson();
  }

  private parseRawJson(): any {
    assert(
      this.easJsonRawContents !== undefined,
      'easJsonRawContents needs to be set before calling parseRawJson'
    );
    if (this.easJsonRawContents.trim().length === 0) {
      throw new InvalidEasJsonError(`${chalk.bold('eas.json')} is empty.`);
    }

    try {
      const rawJSON = JSON.parse(this.easJsonRawContents);
      this.easJsonRawObject = rawJSON;
      return rawJSON;
    } catch {
      // ignore error, try reading as JSON5
    }

    try {
      const rawJSON = fleece.evaluate(this.easJsonRawContents);
      this.easJsonRawObject = rawJSON;
      this.isJson5 = true;
      return rawJSON;
    } catch (originalError: any) {
      if (originalError.loc) {
        const err = new InvalidEasJsonError(
          `Found invalid character in ${chalk.bold('eas.json')}.`
        );
        const codeFrame = codeFrameColumns(this.easJsonRawContents, { start: originalError.loc });
        err.message += `\n${codeFrame}`;
        throw err;
      } else {
        throw new InvalidEasJsonError(`Found invalid JSON in ${chalk.bold('eas.json')}.`);
      }
    }
  }

  private resetState(): void {
    this.isJson5 = false;
    this.easJson = undefined;
    this.easJsonRawContents = undefined;
    this.easJsonRawObject = undefined;
    this.easJsonPatched = false;
  }
}
