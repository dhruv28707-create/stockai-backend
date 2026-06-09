type LogLevel = "info" | "warn" | "error";

const writeLog = (
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void => {
  const payload = {
    level,
    message,
    context,
    timestamp: new Date().toISOString()
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
};

export const logger = {
  info: (message: string, context?: Record<string, unknown>) =>
    writeLog("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    writeLog("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    writeLog("error", message, context)
};
