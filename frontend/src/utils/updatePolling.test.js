import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTransientUpdatePollingError, normalizeUpdateStatus } from './updatePolling';

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
  });

  it('mantem loading no reinicio e recarrega somente quando completed volta pela API', () => {
    const settings = readFileSync(new URL('../pages/Settings.jsx', import.meta.url), 'utf8');
    expect(settings).toContain("message: 'Reiniciando servicos...'");
    expect(settings).toContain("if (nextStatus.state === 'completed')");
    expect(settings).toContain('window.location.reload()');
    expect(settings).toContain('isTransientUpdatePollingError(requestError)');
  });
});
