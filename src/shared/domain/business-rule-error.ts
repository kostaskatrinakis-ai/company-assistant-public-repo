export class BusinessRuleError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "BusinessRuleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
