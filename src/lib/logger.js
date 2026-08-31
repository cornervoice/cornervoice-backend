const isProd = process.env.NODE_ENV === 'production';

function ts() {
  return new Date().toISOString();
}

module.exports = {
  info: (...args) => console.log(`[${ts()}] [INFO]`, ...args),
  warn: (...args) => console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${ts()}] [ERROR]`, ...args),
  // Never log full payloads in production — reviews/messages may contain
  // content a user wouldn't expect to end up in server logs verbatim.
  debug: (...args) => { if (!isProd) console.log(`[${ts()}] [DEBUG]`, ...args); },
};
