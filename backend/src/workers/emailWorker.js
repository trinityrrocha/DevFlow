const { processBatch } = require('../services/emailOutboxService');
const fs = require('fs');

let stopping = false;
const readyFile = '/tmp/devflow-email-worker.ready';
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; });

async function run() {
  console.log(JSON.stringify({ component: 'email-worker', event: 'started' }));
  while (!stopping) {
    try {
      const results = await processBatch();
      fs.writeFileSync(readyFile, new Date().toISOString(), { mode: 0o600 });
      if (results.length) console.log(JSON.stringify({ component: 'email-worker', event: 'batch', jobs: results }));
    } catch (error) {
      console.error(JSON.stringify({ component: 'email-worker', event: 'batch_failed', code: String(error?.code || 'WORKER_ERROR').slice(0, 100) }));
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log(JSON.stringify({ component: 'email-worker', event: 'stopped' }));
  fs.rmSync(readyFile, { force: true });
}

run().catch(() => { process.exitCode = 1; });
