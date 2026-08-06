import { describe, expect, it } from 'vitest';
import { durationInput, formatSignedDuration, parseDurationInput } from './timing';

describe('duracao de tarefas', () => {
  it('converte dd-hh-mm para segundos sem armazenar a apresentacao', () => {
    expect(parseDurationInput('02-08-30')).toBe(203400);
    expect(durationInput(203400)).toBe('02-08-30');
  });
  it('rejeita horas, minutos, zero e limite excessivo', () => {
    expect(parseDurationInput('00-24-00')).toBeNull();
    expect(parseDurationInput('00-00-60')).toBeNull();
    expect(parseDurationInput('00-00-00')).toBeNull();
    expect(parseDurationInput('366-00-00')).toBeNull();
  });
  it('formata atraso com sinal explicito', () => {
    expect(formatSignedDuration(-19200)).toBe('-0d 5h 20min');
  });
});
