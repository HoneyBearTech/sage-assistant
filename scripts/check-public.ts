import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { looksBinary, scanText } from "./lib/public-scan.js";

// The public-repo checker: scans every file git tracks (and new files not yet added, unless
// ignored) for private addresses, LAN host names, home folders and personal e-mail addresses.
// Run it with `npm run check:public`; `npm run verify` runs it too.

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

let problems = 0;
for (const file of files) {
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (looksBinary(data)) continue;
  for (const finding of scanText(file, data.toString("utf8"))) {
    problems++;
    console.error(`${finding.file}:${finding.line}: ${finding.kind}: ${finding.match}`);
  }
}

if (problems > 0) {
  console.error(`\nThe public-repo check found ${problems} problem(s). Replace them with placeholders.`);
  process.exit(1);
}
console.log(`Public-repo check passed (${files.length} files).`);
