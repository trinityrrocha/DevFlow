class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const assert = (condition, code, message, status = 400, details) => {
  if (!condition) throw new AppError(code, message, status, details);
};

module.exports = { AppError, assert };
