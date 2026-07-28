import type { CtDomainErrorCode } from "./types.ts";

export class CtDomainError extends Error {
  readonly code: CtDomainErrorCode;

  constructor(code: CtDomainErrorCode, message = code) {
    super(message);
    this.name = "CtDomainError";
    this.code = code;
  }
}

export function assertCt(condition: unknown, code: CtDomainErrorCode): asserts condition {
  if (!condition) throw new CtDomainError(code);
}
