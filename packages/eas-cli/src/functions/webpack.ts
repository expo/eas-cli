import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { Compiler, Configuration, EntryObject, webpack } from 'webpack';

import Log from '../log';
import { formatWebpackMessages } from './formatWebpackMessages';

async function getWebpackFunctionConfigurationAsync(
  entry: EntryObject,
  outputPath: string
): Promise<Configuration> {
  const webpackConfig = {
    entry,
    target: 'node',
    mode: 'development' as 'development',
    // Disable file info logs.
    //stats: 'none',

    // https://webpack.js.org/configuration/other-options/#bail
    // Fail out on the first error instead of tolerating it.
    bail: true,

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
      filename: '[name].js',
      path: outputPath,
      library: {
        type: 'commonjs',
      },
    },
  };

  return webpackConfig;
}

async function compileWebAppAsync(compiler: Compiler): Promise<any> {
  // We generate the stats.json file in the webpack-config
  const { warnings } = await new Promise((resolve, reject) =>
    compiler.run((error, stats) => {
      let messages;
      if (error) {
        if (!error.message) {
          return reject(error);
        }
        messages = formatWebpackMessages({
          errors: [error.message],
          warnings: [],
          _showErrors: true,
          _showWarnings: true,
        });
      } else {
        messages = formatWebpackMessages(
          stats?.toJson({ all: false, warnings: true, errors: true })
        );
      }

      if (messages.errors.length) {
        // Only keep the first error. Others are often indicative
        // of the same problem, but confuse the reader with noise.
        if (messages.errors.length > 1) {
          messages.errors.length = 1;
        }
        return reject(messages.errors.join('\n\n'));
      }
      resolve({
        warnings: messages.warnings,
      });
    })
  );
  return { warnings };
}

export async function bundleFunctionsAsync(entry: EntryObject, outputPath: string): Promise<void> {
  const config = await getWebpackFunctionConfigurationAsync(entry, outputPath);
  const compiler = webpack(config);
  try {
    const { warnings } = await compileWebAppAsync(compiler);
    if (warnings.length) {
      Log.warn(chalk.yellow('Compiled with warnings.\n'));
      Log.warn(warnings.join('\n\n'));
    } else {
      Log.log(chalk.green('Compiled successfully.\n'));
    }
  } catch (error) {
    Log.error(chalk.red('Failed to compile.\n'));
    Log.error(error);
    throw error;
  }
}

export async function prepareFunctionEntriesAsync(functionsPath: string): Promise<EntryObject> {
  const files = await fs.readdir(functionsPath);
  if (files.length === 0) {
    throw new Error(`No functions found in ${functionsPath}`);
  }

  const entries = {} as EntryObject;
  for (const file of files) {
    const filenameNoExtension = path.parse(file).name;
    entries[filenameNoExtension] = path.join(functionsPath, file);
  }

  return entries;
}
