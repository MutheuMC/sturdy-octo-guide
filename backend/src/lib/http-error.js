function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

module.exports = { httpError };
