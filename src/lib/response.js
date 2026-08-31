class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function ok(res, data) {
  res.status(200).json({ data });
}

function errorResponse(res, err) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  // Same principle as the product backend: never leak raw internal
  // error messages (stack traces, SDK internals, DB errors) to the
  // client on a 500 — only ever return AppError's own, deliberately
  // written message.
  const message = status === 500
    ? 'Something went wrong processing your request. Please try again shortly.'
    : err.message;

  res.status(status).json({ error: { code, message, status } });
}

module.exports = { AppError, ok, errorResponse };
