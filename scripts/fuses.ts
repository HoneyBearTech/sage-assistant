import { flipFuses } from "@electron/fuses";
import { SAGE_FUSES } from "../src/main/fuses-config.js";

// Flips Electron's hardening fuses on a packaged Sage binary:
//   npm run fuses -- <path to the packaged Electron executable>
// For the installer job. Don't run it on node_modules/electron: "only load from ASAR" would stop
// `npm start` from working until you reinstall Electron.

const target = process.argv[2];
if (!target) {
  console.error("Usage: npm run fuses -- <path to the packaged Electron executable>");
  process.exit(2);
}
if (/node_modules[\\/]electron[\\/]/.test(target)) {
  console.error("Refusing to change the development copy of Electron in node_modules.");
  process.exit(2);
}
await flipFuses(target, SAGE_FUSES);
console.log(`Fuses set on ${target}.`);
