const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { missingRequirements } = require('../src/services/workflowService');

const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('etapa de aprovação do frontend', () => {
  const migration = read('../database/migrations/014_frontend_approval_stage.sql');
  const tenantService = read('src/services/tenantService.js');
  const detail = read('../frontend/src/pages/TaskDetail.jsx');

  it('insere a etapa de forma repetível logo após Frontend', () => {
    expect(migration).toContain("frontend.code = 'FRONTEND'");
    expect(migration).toContain("approval.code = 'FRONTEND_APPROVAL'");
    expect(migration).toContain('ORDER BY sort_order DESC');
    expect(migration).toContain('stage_record.sort_order + 10');
    expect(migration).toContain("'FRONTEND_APPROVAL'");
    expect(migration).toContain("'{\"approval\": true}'::jsonb");
    expect(migration).not.toContain('RAISE EXCEPTION');
  });

  it('inclui a etapa nos novos fluxos antes de Update GitHub', () => {
    const frontend = tenantService.indexOf("stage('FRONTEND', 'Frontend'");
    const approval = tenantService.indexOf("stage('FRONTEND_APPROVAL', 'Aprovação do Frontend'");
    const github = tenantService.indexOf("stage('GITHUB_UPDATE', 'Update GitHub'");
    expect(frontend).toBeGreaterThan(-1);
    expect(approval).toBeGreaterThan(frontend);
    expect(github).toBeGreaterThan(approval);
  });

  it('bloqueia avanço sem aprovação e aceita somente a decisão aprovada', () => {
    const stage = { id: 'frontend-approval-id', name: 'Aprovação do Frontend', requirements: { approval: true } };
    expect(missingRequirements({}, { approvals: [] }, stage)).toEqual(['Aprovação de Aprovação do Frontend']);
    expect(missingRequirements({}, { approvals: [{ stage_id: stage.id, decision: 'REJECTED' }] }, stage)).toEqual(['Aprovação de Aprovação do Frontend']);
    expect(missingRequirements({}, { approvals: [{ stage_id: stage.id, decision: 'APPROVED' }] }, stage)).toEqual([]);
  });

  it('registra aprovação, reprovação, comentário, anexo e transição pela interface dedicada', () => {
    expect(detail).toContain("isFrontendApprovalStage");
    expect(detail).toContain("decision: 'APPROVED'");
    expect(detail).toContain("decision: 'REJECTED'");
    expect(detail).toContain('Motivo da Reprovação');
    expect(detail).toContain('Reprovar / Devolver para Frontend');
    expect(detail).toContain("body.append('comment_id', response.data.comment.id)");
    expect(detail).toContain("body.append('sourceSection', 'comentarios')");
    expect(detail).toContain('target_stage: previousStage.id, reason');
    expect(detail).toContain('target_stage: nextStage.id');
  });
});
