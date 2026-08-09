const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createSignedRequest } = require('../src/services/updateOperationService');

describe('fila privada de atualizacao', () => {
  it('gera o contrato operacional solicitado e preserva a assinatura HMAC', () => {
    const request = createSignedRequest('Admin@Example.com');
    const { signature, ...unsigned } = request;
    const expected = crypto.createHmac('sha256', process.env.UPDATE_REQUEST_SECRET)
      .update(JSON.stringify(unsigned)).digest('hex');
    expect(request).toMatchObject({
      schemaVersion: 2,
      action: 'update',
      requester: 'admin@example.com',
      requestedBy: 'admin@example.com',
      operation: 'install-update'
    });
    expect(request.timestamp).toBe(request.requestedAt);
    expect(signature).toBe(expected);
  });

  it('mantem a gravacao atomica do arquivo fisico no controller', () => {
    const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/updateOperationController.js'), 'utf8');
    expect(controller).toContain('fs.writeFileSync(temporary');
    expect(controller).toContain('fs.renameSync(temporary, destination)');
    expect(controller.indexOf('writeStatus(')).toBeLessThan(controller.indexOf('fs.renameSync'));
  });
});
