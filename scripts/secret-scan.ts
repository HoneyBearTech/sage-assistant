import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Runs the gitleaks secret scanner over the git history and the working tree. If gitleaks isn't
// installed the scan is skipped with a message, so `npm run verify` still works on a new machine.

function findGitleaks(): string | null {
  const candidates = [
    process.env.GITLEAKS,
    join(homedir(), ".local", "bin", process.platform === "win32" ? "gitleaks.exe" : "gitleaks"),
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  const onPath = spawnSync(process.platform === "win32" ? "gitleaks.exe" : "gitleaks", ["version"], {
    stdio: "ignore",
  });
  return onPath.status === 0 ? "gitleaks" : null;
}

const gitleaks = findGitleaks();
if (!gitleaks) {
  console.log(
    "Secret scan skipped: gitleaks is not installed. Install it from https://github.com/gitleaks/gitleaks/releases (or set GITLEAKS to its path) to run this check.",
  );
  process.exit(0);
}

const common = ["--redact", "--no-banner", "--exit-code", "1", "--config", ".gitleaks.toml"];
for (const args of [
  ["git", ...common, "."],
  ["dir", ...common, "."],
]) {
  const result = spawnSync(gitleaks, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(
      `Secret scan failed (gitleaks ${args[0]}). Remove the secret, and revoke it if it was real.`,
    );
    process.exit(1);
  }
}
console.log("Secret scan passed.");
