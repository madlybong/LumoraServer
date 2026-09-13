export const LoggerService = {
  log: (message: string) => {
    console.log(`[LoggerService] ${new Date().toISOString()} - ${message}`);
  }
};
