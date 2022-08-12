module.exports = function () {
  const config = require('./store.config.json');
  config.apple.copyright = `${new Date().getFullYear()} ACME`;
  return config;
};
