/** Error the /api/v1 handlers turn into the JSON envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}
