const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

describe('rastreamento temporal por etapa', () => {
  const migration = read('database/migrations/011_stage_time_tracking.sql');
  const tasks = read('backend/src/services/taskService.js');
  const timing = read('backend/src/services/taskTimingService.js');
  const dashboard = read('backend/src/services/dashboardService.js');
  const attachments = read('backend/src/services/attachmentService.js');
  const controller = read('backend/src/controllers/taskController.js');

  it('persiste chegada da etapa e sessoes de touch time vinculadas ao usuario', () => {
    expect(migration).toContain('current_stage_entered_at TIMESTAMPTZ');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS stage_id UUID');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS task_stage_touch_sessions');
    expect(migration).toContain('ON task_stage_touch_sessions (task_id,stage_id,user_id)');
    expect(timing).toContain('company_id,task_id,stage_id,user_id,started_at');
  });

  it('encerra touch e lead time antigos antes de abrir a nova etapa', () => {
    const closeTouch = tasks.indexOf('endReason: \'STAGE_TRANSITION\'');
    const closeLead = tasks.indexOf('UPDATE task_stage_intervals SET ended_at=CURRENT_TIMESTAMP', closeTouch);
    const resetTimer = tasks.indexOf('active_elapsed_seconds=0', closeLead);
    const openLead = tasks.indexOf('INSERT INTO task_stage_intervals', resetTimer);
    expect(closeTouch).toBeGreaterThan(-1);
    expect(closeLead).toBeGreaterThan(closeTouch);
    expect(resetTimer).toBeGreaterThan(closeLead);
    expect(openLead).toBeGreaterThan(resetTimer);
    expect(tasks).toContain("timer_status=CASE WHEN $4 THEN 'completed' ELSE 'not_started' END");
  });

  it('exclui Roadmap da geracao e agregacao das metricas', () => {
    expect(tasks).toContain('const stageTracksTime');
    expect(tasks).toContain('!isRoadmap(stage)');
    expect(timing).toContain('A etapa Roadmap nao permite controle de tempo.');
    expect(dashboard).toContain("UPPER(i.stage_code_snapshot)<>'ROADMAP'");
    expect(dashboard).toContain('FROM task_stage_touch_sessions session');
  });

  it('normaliza MIME no backend e libera inline apenas para previews seguros', () => {
    expect(attachments).toContain("['.png', 'image/png']");
    expect(attachments).toContain("['.mp4', 'video/mp4']");
    expect(attachments).toContain('canonicalMimeType');
    expect(controller).toContain('/^(image|video)\\//u');
    expect(controller).toContain("attachment.mime_type === 'application/pdf'");
  });
});
