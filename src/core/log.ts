/** A small logger that never writes a registered secret, whatever the message contains. */
export type LogLevel = "info" | "warn" | "error";
export type LogSink = (level: LogLevel, line: string) => void;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export class SecretRedactor {
  private readonly secrets = new Set<string>();

  add(secret: string): void {
    if (secret.length > 0) this.secrets.add(secret);
  }

  remove(secret: string): void {
    this.secrets.delete(secret);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join("[redacted]");
    return out;
  }
}

export const consoleSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export function createLogger(sink: LogSink, redactor: SecretRedactor): Logger {
  const write = (level: LogLevel, message: string) =>
    sink(level, redactor.redact(`[sage] ${level}: ${message}`));
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message, error) =>
      write("error", error === undefined ? message : `${message}: ${describeError(error)}`),
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
