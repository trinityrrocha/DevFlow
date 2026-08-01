const normalize = (value, length = 160) => String(value || '')
  .replace(/[\r\n\t]+/g, ' ')
  .slice(0, length);

const safeLogError = (context, error) => {
  console.error(normalize(context), {
    name: normalize(error?.name, 80),
    code: normalize(error?.code, 80),
    status: Number(error?.status || 0) || undefined,
    ...(process.env.NODE_ENV !== 'production' && error?.stack
      ? { stack: String(error.stack).slice(0, 4000) }
      : {})
  });
};

module.exports = { safeLogError };
