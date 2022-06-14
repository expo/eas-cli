import { AppInfo, AppInfoLocalization } from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { retryIfNullAsync } from '../../utils/retry';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type AppInfoData = {
  /** The current app info that should be edited */
  info: AppInfo;
  /** All info locales that are enabled */
  infoLocales: AppInfoLocalization[];
};

export class AppInfoTask extends AppleTask {
  public name = (): string => 'app information';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    const info = await retryIfNullAsync(() => context.app.getEditAppInfoAsync());
    assert(info, 'Could not resolve the editable app info to update');

    context.info = info;
    context.infoLocales = await info.getLocalizationsAsync();
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    assert(context.info, `App info not initialized, can't download info`);

    config.setCategories(context.info.attributes);

    for (const locale of context.infoLocales) {
      config.setInfoLocale(locale.attributes);
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    assert(context.info, `App info not initialized, can't update info`);

    const categories = config.getCategories();
    if (!categories) {
      Log.log(chalk`{dim - Skipped app category update, not configured}`);
    } else {
      context.info = await logAsync(() => context.info.updateCategoriesAsync(categories), {
        pending: 'Updating app categories...',
        success: 'Updated app categories',
        failure: 'Failed updating app categories',
      });
    }

    const locales = config.getLocales();
    if (locales.length <= 0) {
      Log.log(chalk`{dim - Skipped localized info update, no locales configured}`);
    } else {
      // BUG: new issue introduced in ASC 1.8.0, when creating version locales, info locales are also generated
      context.infoLocales = await logAsync(() => context.info.getLocalizationsAsync(), {
        pending: 'Reloading localized info...',
        success: 'Reloaded localized info',
        failure: 'Failed reloading localized info',
      });

      for (const locale of locales) {
        const attributes = config.getInfoLocale(locale);
        if (!attributes) {
          continue;
        }

        const model = context.infoLocales.find(model => model.attributes.locale === locale);
        await logAsync(
          async () => {
            return model
              ? await model.updateAsync(attributes)
              : await context.info.createLocalizationAsync({ ...attributes, locale });
          },
          {
            pending: `${model ? 'Updating' : 'Creating'} localized info for ${chalk.bold(
              locale
            )}...`,
            success: `${model ? 'Updated' : 'Created'} localized info for ${chalk.bold(locale)}`,
            failure: `Failed ${model ? 'updating' : 'creating'} localized info for ${chalk.bold(
              locale
            )}`,
          }
        );
      }

      context.infoLocales = await context.info.getLocalizationsAsync();
    }
  }
}
