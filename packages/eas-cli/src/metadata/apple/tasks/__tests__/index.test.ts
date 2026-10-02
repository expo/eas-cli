import { createAppleTasks } from '../index';
import { PreviewsTask } from '../previews';
import { ScreenshotsTask } from '../screenshots';

describe(createAppleTasks, () => {
  it('includes the screenshots and previews tasks by default', () => {
    const tasks = createAppleTasks();

    expect(tasks.some(task => task instanceof ScreenshotsTask)).toBe(true);
    expect(tasks.some(task => task instanceof PreviewsTask)).toBe(true);
  });

  it('omits the screenshots task when skipScreenshots is enabled', () => {
    const defaultTasks = createAppleTasks();
    const tasks = createAppleTasks({ skipScreenshots: true });

    expect(tasks.some(task => task instanceof ScreenshotsTask)).toBe(false);
    expect(tasks.some(task => task instanceof PreviewsTask)).toBe(true);
    expect(tasks).toHaveLength(defaultTasks.length - 1);
  });

  it('omits the previews task when skipPreviews is enabled', () => {
    const defaultTasks = createAppleTasks();
    const tasks = createAppleTasks({ skipPreviews: true });

    expect(tasks.some(task => task instanceof PreviewsTask)).toBe(false);
    expect(tasks.some(task => task instanceof ScreenshotsTask)).toBe(true);
    expect(tasks).toHaveLength(defaultTasks.length - 1);
  });

  it('omits both tasks when skipScreenshots and skipPreviews are enabled', () => {
    const defaultTasks = createAppleTasks();
    const tasks = createAppleTasks({ skipScreenshots: true, skipPreviews: true });

    expect(tasks.some(task => task instanceof ScreenshotsTask)).toBe(false);
    expect(tasks.some(task => task instanceof PreviewsTask)).toBe(false);
    expect(tasks).toHaveLength(defaultTasks.length - 2);
  });
});
