process.on('SIGTERM', () => process.exit(23));
setInterval(() => {}, 1000);
process.send('ready');
