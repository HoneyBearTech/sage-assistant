import { FuseV1Options, FuseVersion } from "@electron/fuses";

/**
 * Electron's hardening switches for the packaged app. electron-builder sets them on `Sage.exe` from
 * the `electronFuses` block in electron-builder.json (`npm run dist` or `npm run dist:dir`); this
 * file is the reviewed list, and test/security.test.ts checks that the two never drift apart. Never
 * flip them on the copy in node_modules: "only load from ASAR" stops `npm start` from working.
 */
export const SAGE_FUSES = {
  version: FuseVersion.V1,
  // The binary can't be used as a plain Node.js runtime (ELECTRON_RUN_AS_NODE is ignored).
  [FuseV1Options.RunAsNode]: false,
  // Cookies on disk are encrypted with the operating system's keys. Sage keeps no cookies; this is
  // a safety net.
  [FuseV1Options.EnableCookieEncryption]: true,
  // NODE_OPTIONS can't inject code or flags.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // --inspect and friends can't attach a debugger to the main process.
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // The app archive is checked against the hash built into the binary.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  // The app is only ever loaded from that archive, never from loose files next to it.
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // Pages loaded from file:// get no powers beyond an ordinary web page (no fetch of other local
  // files, no service workers). Sage's window doesn't need them.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
} as const;
