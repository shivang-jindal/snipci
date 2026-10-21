// Error types for snipci. Every SnipciError carries an exit code so the CLI
// can map failures to the SPEC exit-code contract:
//   0 all pass · 1 failures · 2 usage/config · 3 internal (partial results).

export class SnipciError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SnipciError';
    this.exitCode = options.exitCode ?? 2;
    this.code = options.code ?? 'ERR_SNIPCI';
    this.file = options.file ?? null;
    this.line = options.line ?? null;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  get location() {
    if (!this.file) return null;
    return this.line != null ? `${this.file}:${this.line}` : this.file;
  }

  format() {
    const loc = this.location;
    return loc ? `${loc}: ${this.message}` : this.message;
  }
}

export function directiveError(message, loc = {}) {
  return new SnipciError(message, {
    code: 'ERR_DIRECTIVE',
    exitCode: 2,
    file: loc.file ?? null,
    line: loc.line ?? null,
  });
}

export function usageError(message) {
  return new SnipciError(message, { code: 'ERR_USAGE', exitCode: 2 });
}

export function configError(message, file = null) {
  return new SnipciError(message, { code: 'ERR_CONFIG', exitCode: 2, file });
}
