export class LumoraHttpError extends Error {
  public status: number;
  public code: string;
  public details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "LumoraHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
