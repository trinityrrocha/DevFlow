export const fixture = Object.freeze({
  installedVersion: '0.6.26-alpha',
  installedCommit: '055e5289d2a817aedda863e4f6faaf93fab480de',
  availableVersion: '0.6.27-alpha',
  availableCommit: 'd84387963dc0797ce2d0bf3965480da727182a80'
});

export function simulateLegacyAfterPull({ certificateMounted }) {
  const steps = ['pre-health', 'git-fetch', 'git-checkout', 'git-pull'];
  if (!certificateMounted) {
    return {
      steps,
      command: 'render_runtime_nginx_config',
      exitCode: 1,
      realFailedPhase: 'source',
      displayedPhase: 'rollback-started'
    };
  }
  return { steps: [...steps, 'build'], exitCode: 0 };
}

export function simulateNewFlow({ installed = fixture.installedCommit, available = fixture.availableCommit, failAt = null }) {
  if (installed === available) return { result: 'current', steps: ['check'] };
  const steps = ['pre-health', 'git-fetch', 'git-checkout', 'git-pull', 'build', 'migrations', 'compose-up', 'final-health', 'source-fast-forward'];
  if (!failAt) return { result: 'completed', steps, imageTag: `release-${available}`, updaterAlive: true };
  const failedIndex = steps.indexOf(failAt);
  return {
    result: 'failed',
    steps: steps.slice(0, failedIndex + 1),
    rollback: 'successful',
    restoredCommit: installed,
    imageTag: `release-${installed}`,
    manualRecoveryRequired: failedIndex >= steps.indexOf('migrations')
  };
}
