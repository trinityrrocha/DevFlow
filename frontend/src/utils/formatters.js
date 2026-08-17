export const LABELS = {
  REQUEST: 'Solicitação',
  BUG: 'Bug',
  ROADMAP: 'Roadmap',
  REPORT_BUG: 'Report Bug',
  BACKEND: 'Backend',
  FRONTEND: 'Frontend',
  FRONTEND_APPROVAL: 'Aprovação do Frontend',
  GITHUB_UPDATE: 'Update GitHub',
  TESTING: 'Testando',
  REVIEW: 'Revisando',
  PRODUCTION: 'Produção',
  ACTIVE: 'Em andamento',
  PAUSED: 'Pausada',
  CANCELED: 'Cancelada',
  COMPLETED: 'Concluída',
  INACTIVE: 'Inativo',
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
  URGENT_PRODUCTION: 'Urgente',
  DEVELOPMENT: 'Desenvolvimento',
  HOMOLOGATION: 'Homologação',
  PRODUCTION_ENV: 'Produção',
  SPECIFIC_CLIENT: 'Cliente específico',
  LOCAL: 'Ambiente local',
  NEW_FEATURE: 'Nova funcionalidade',
  IMPROVEMENT: 'Melhoria',
  VISUAL_ADJUSTMENT: 'Ajuste visual',
  PERFORMANCE: 'Performance',
  REFACTORING: 'Refatoração',
  FIX: 'Correção',
  INTEGRATION: 'Integração',
  DOCUMENTATION: 'Documentação',
  OTHER: 'Outro',
  PASSED: 'Aprovado',
  FAILED: 'Falhou',
  BLOCKED: 'Bloqueado',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado'
};

export const label = (value) => LABELS[value]
  || (value ? String(value).toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) : '—');

export const priorityDisplayName = (priority) => {
  const code = typeof priority === 'object' ? priority?.priority || priority?.code : priority;
  if (String(code || '').toUpperCase() === 'URGENT_PRODUCTION') return 'Urgente';
  const name = typeof priority === 'object' ? priority?.name || priority?.priority_name : null;
  return name || label(code);
};

export const formatDate = (value) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—';

export const formatDuration = (secondsValue) => {
  const seconds = Math.max(0, Number(secondsValue || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}min`].filter(Boolean).join(' ');
};
