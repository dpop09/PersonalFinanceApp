require('dotenv').config();
const app = require('./app');
const { initializeDatabase, closeDatabase } = require('./db');

async function startServer() {
  await initializeDatabase();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, '127.0.0.1');
    instance.once('listening', () => resolve(instance));
    instance.once('error', reject);
  });
  return { server, url: `http://127.0.0.1:${port}` };
}

if (require.main === module) {
  startServer().then(({ url }) => console.log(`Personal Finance is running at ${url}`)).catch(error => {
    console.error('Could not start Personal Finance:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { startServer, closeDatabase };
