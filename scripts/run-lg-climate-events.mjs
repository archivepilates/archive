import { runReceiver } from '../services/lg-climate-events/runtime.mjs';
import { createLogger, safeCode } from '../services/lg-climate-events/logger.mjs';

// This executable is the only module that starts the receiver.
runReceiver().then(() => process.exit(0)).catch(error => {
  createLogger()(safeCode(error));
  process.exit(1);
});
