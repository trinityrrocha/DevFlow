const multer = require('multer');
const { ZodError } = require('zod');
const { AppError } = require('../utils/errors');
const { safeLogError } = require('../utils/safeLogger');
const { recordAudit } = require('../services/auditService');

function notFound(req, _res, next) {
  next(new AppError('NOT_FOUND', `Rota não encontrada: ${req.method} ${req.path}`, 404));
}

async function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      error: 'Dados inválidos.',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
  }
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      code: error.code,
      error: error.code === 'LIMIT_FILE_SIZE' ? 'O arquivo excede o limite permitido.' : 'Upload inválido.'
    });
  }
  if (error instanceof AppError) {
    if ([401, 403].includes(error.status)) {
      await recordAudit({
        req,
        operation: 'REQUEST_DENIED',
        entityType: 'HTTP_REQUEST',
        status: 'DENIED',
        newValues: {
          method: req.method,
          path: req.path,
          reason: error.code
        }
      });
    }
    return res.status(error.status).json({
      code: error.code,
      error: error.message,
      ...(error.details ? { details: error.details } : {})
    });
  }
  safeLogError('Erro não tratado na API.', error);
  return res.status(500).json({ code: 'INTERNAL_ERROR', error: 'Erro interno do servidor.' });
}

module.exports = { notFound, errorHandler };
