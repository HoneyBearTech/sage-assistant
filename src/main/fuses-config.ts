import { FuseV1Options, FuseVersion } from "@electron/fuses";

/**
 * Electron's hardening switches, flipped in the packaged app by `npm run fuses -- <path to the
 * Electron binary>`. The installer job runs it on the packaged binary; never run it on the copy in
 * node_modules, because "only load from ASAR" stops `npm start` from working.
 */
export const SAGE_FUSES = {
  version: FuseVersion.V1,
  // The binary can't be used as a plain Node.js runtime (ELECTRON_RUN_AS_NODE is ignored).
  [FuseV1Options.RunAsNode]: false,
  // NODE_OPTIONS can't inject code or flags.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // --inspect and friends can't attach a debugger to the main process.
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // The app archive is checked against the hash built into the binary.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  // The app is only ever loaded from that archive, never from loose files next to it.
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} as const;
