describe('carregamento estrutural do backend', () => {
  it('carrega a aplicação e todos os serviços sem efeitos de inicialização', () => {
    expect(() => require('../src/app')).not.toThrow();
    for (const service of [
      'attachmentService',
      'auditService',
      'catalogService',
      'dashboardService',
      'emailOutboxService',
      'emailTemplateService',
      'mfaPolicyService',
      'mfaService',
      'notificationService',
      'sessionService',
      'taskService',
      'tenantService',
      'workflowService'
    ]) {
      expect(() => require(`../src/services/${service}`)).not.toThrow();
    }
  }, 20000);
});
