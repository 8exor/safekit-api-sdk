export class SafeKitError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "SafeKitError";
    this.code = code;
    this.details = details;
  }
}
