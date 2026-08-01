import { describe, expect, it } from 'vitest';
import { formatDuration, label } from './formatters';

describe('formatters', () => {
  it('traduz estados e prioridades para português', () => {
    expect(label('ACTIVE')).toBe('Em andamento');
    expect(label('URGENT_PRODUCTION')).toBe('Urgente Produção');
  });

  it('formata duração acumulada sem incluir segundos isolados', () => {
    expect(formatDuration(90061)).toBe('1d 1h 1min');
    expect(formatDuration(0)).toBe('0min');
  });
});
