module.exports = async () => {
  process.env.TZ = 'UTC';
  process.env.EAS_NO_VCS = '1';
  process.env.EAS_PROJECT_ROOT = '/app';
  process.env.FORCE_COLOR = '1';
};
