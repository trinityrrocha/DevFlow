export const fixture = Object.freeze({
  backend: Object.freeze({ uid: 100, gid: 101, supplementalGroups: Object.freeze([]) }),
  legacyStatus: Object.freeze({ uid: 0, gid: 0, mode: 0o600 }),
  operationalGid: 101,
  correctedStatus: Object.freeze({ uid: 0, gid: 101, mode: 0o640 })
});

export function canRead(subject, artifact) {
  if (subject.uid === 0) return true;
  if (subject.uid === artifact.uid) return Boolean(artifact.mode & 0o400);
  if (subject.gid === artifact.gid || subject.supplementalGroups.includes(artifact.gid)) {
    return Boolean(artifact.mode & 0o040);
  }
  return Boolean(artifact.mode & 0o004);
}

export function simulateLegacyRequestStatus() {
  const readable = canRead(fixture.backend, fixture.legacyStatus);
  return Object.freeze({ readable, filesystemResult: readable ? 'read' : 'EACCES', httpStatus: readable ? 200 : 503, frontend: readable ? 'completed' : 'Excluindo...' });
}

export function simulateCorrectedRequestStatus() {
  const backend = { ...fixture.backend, supplementalGroups: [fixture.operationalGid] };
  const readable = canRead(backend, fixture.correctedStatus);
  return Object.freeze({ readable, filesystemResult: readable ? 'read' : 'EACCES', httpStatus: readable ? 200 : 503, state: readable ? 'completed' : null });
}
