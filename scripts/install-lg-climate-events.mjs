import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installReceiver } from '../services/lg-climate-events/installer.mjs';
import { safeCode } from '../services/lg-climate-events/logger.mjs';

process.umask(0o077);
try {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw Object.assign(new Error(), { code: 'INSTALL_ARGUMENTS' });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(JSON.stringify(installReceiver({ root, mode: args[0] })));
} catch (error) {
  console.error(JSON.stringify({ code: safeCode(error) }));
  process.exitCode = 1;
}
