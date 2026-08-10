import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTransientUpdatePollingError, normalizeUpdateStatus, updatePollingOutcome } from './updatePolling';

describe('polling resiliente do updater', () => {
  it.each([502, 503, 504])('trata HTTP %s como reinicio temporario', (status) => {
    expect(isTransientUpdatePollingError({ response: { status } })).toBe(true);
  });

  it('trata timeout, Network Error e FetchError como indisponibilidade temporaria', () => {
    expect(isTransientUpdatePollingError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTransientUpdatePollingError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true);
    expect(isTransientUpdatePollingError({ name: 'FetchError' })).toBe(true);
    expect(isTransientUpdatePollingError({ response: { status: 404 } })).toBe(false);
  });

  it('normaliza status de ciclo de vida sem perder a fase detalhada', () => {
    expect(normalizeUpdateStatus({ status: 'processing' })).toMatchObject({ state: 'processing' });
    expect(normalizeUpdateStatus({ status: 'processing', state: 'migrations' })).toMatchObject({ state: 'migrations' });
    expect(normalizeUpdateStatus({ status: 'completed', state: 'health' })).toMatchObject({ state: 'completed' });
    expect(normalizeUpdateStatus({ status: 'failed', state: 'rollback' })).toMatchObject({ state: 'failed' });
  });

  it('sinaliza reload assim que o ciclo volta como completed depois do reinicio', () => {
    const duringRestart = isTransientUpdatePollingError({ response: { status: 503 } });
    const recovered = updatePollingOutcome({ status: 'completed', state: 'health' });
    expect(duringRestart).toBe(true);
    expect(recovered).toMatchObject({ shouldReload: true, shouldStop: true });
    expect(recovered.status.state).toBe('completed');
  });

  it('encerra polling em failed sem solicitar reload', () => {
    expect(updatePollingOutcome({ status: 'failed', state: 'rollback' })).toMatchObject({
      shouldReload: false,
      shouldStop: true,
      status: { state: 'failed' }
    });
  });

  it('mantem loading no reinicio e recarrega somente quando completed volta pela API', () => {
    const settings = readFileSync(new URL('../pages/Settings.jsx', import.meta.url), 'utf8');
    expect(settings).toContain("message: 'Reiniciando servicos...'");
    expect(settings).toContain('if (outcome.shouldReload)');
    expect(settings).toContain('window.location.reload()');
    expect(settings).toContain('isTransientUpdatePollingError(requestError)');
    expect(settings).toContain('requestInFlight');
    expect(settings).toContain('{ timeout: 5000 }');
    expect(settings).toContain('stopPolling()');
    expect(settings).toContain('}, [queued?.id]);');
  });
});
