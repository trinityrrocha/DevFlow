const env = require('../config/env');
const {
  queueReady, assertQueueReady, createSignedRequest: createOperationalRequest,
  writeStatus, getRequestStatus, queueDirectories, STATES
} = require('./operationalRequestService');

const UPDATE_ENGINE = 'scripts/update.sh';
const UPDATE_OPERATIONS = Object.freeze(['install-update']);
const UPDATE_STATES = STATES;
const REPOSITORY_API = 'https://api.github.com/repos/trinityrrocha/DevFlow';
const RAW_MAIN = 'https://raw.githubusercontent.com/trinityrrocha/DevFlow/main';
const updaterQueueReady = queueReady;

const assertUpdaterQueueReady = assertQueueReady;

function changelogSection(content, version) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => line.startsWith('## ['));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join('\n').trim().slice(0, 12000);
}

async function fetchPublicText(url) {
  const response = await globalThis.fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DevFlow-Updater' },
    signal: globalThis.AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`upstream-${response.status}`);
  return response.text();
}

async function getUpdateCapabilities() {
  let availableVersion = env.DEVFLOW_VERSION;
  let availableCommit = env.DEVFLOW_RELEASE_COMMIT;
  let changelog = '';
  let checkAvailable = false;
  if (env.UPDATE_API_ENABLED) {
    try {
      const [versionText, commitText, changelogText] = await Promise.all([
        fetchPublicText(`${RAW_MAIN}/VERSION`),
        fetchPublicText(`${REPOSITORY_API}/commits/main`),
        fetchPublicText(`${RAW_MAIN}/CHANGELOG.md`)
      ]);
      availableVersion = versionText.trim();
      availableCommit = JSON.parse(commitText).sha;
      if (!/^[0-9a-f]{40}$/.test(availableCommit) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(availableVersion)) throw new Error('identity');
      changelog = changelogSection(changelogText, availableVersion);
      if (!changelog) throw new Error('changelog');
      checkAvailable = true;
    } catch {
      checkAvailable = false;
    }
  }
  const queueReady = updaterQueueReady();
  return Object.freeze({
    enabled: env.UPDATE_API_ENABLED,
    executionAvailable: env.UPDATE_API_ENABLED && checkAvailable && queueReady,
    queueReady,
    engine: UPDATE_ENGINE,
    installedVersion: env.DEVFLOW_VERSION,
    installedCommit: env.DEVFLOW_RELEASE_COMMIT,
    availableVersion,
    availableCommit,
    updateAvailable: checkAvailable && availableCommit !== env.DEVFLOW_RELEASE_COMMIT,
    changelog,
    safeguards: ['backup-manual-recomendado', 'manutencao-http-503', 'rollback-operacional'],
    operations: UPDATE_OPERATIONS,
    transport: 'signed-private-queue'
  });
}

function createSignedRequest(actorEmail) {
  return createOperationalRequest({ actorEmail, operation: 'install-update' });
}

function getUpdateQueueDirectories() {
  return queueDirectories();
}

module.exports = {
  getUpdateCapabilities,
  updaterQueueReady,
  assertUpdaterQueueReady,
  createSignedRequest,
  writeStatus,
  getRequestStatus,
  getUpdateQueueDirectories,
  UPDATE_ENGINE,
  UPDATE_OPERATIONS,
  UPDATE_STATES
};
