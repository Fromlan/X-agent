import { join } from "node:path";
import {
  checkPiCli,
  quoteWinCmdArg,
  resolveNpmFromPathEnv,
  resolvePiFromPathEnv,
  spawnOptsForCli,
} from "../electron/agent/pi-cli";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const winPath = ["C:\\npm", "C:\\tools"].join(";");
const unixPath = ["/usr/local/bin", "/opt/bin"].join(":");

const winExists = (p: string) =>
  p === join("C:\\npm", "pi.cmd") || p === join("C:\\npm", "npm.cmd");

const unixExists = (p: string) =>
  p === join("/usr/local/bin", "pi") || p === join("/usr/local/bin", "npm");

assert(
  resolvePiFromPathEnv(winPath, "win32", winExists) === join("C:\\npm", "pi.cmd"),
  "windows should resolve pi.cmd",
);
assert(
  resolveNpmFromPathEnv(winPath, "win32", winExists) === join("C:\\npm", "npm.cmd"),
  "windows should resolve npm.cmd",
);
assert(
  resolvePiFromPathEnv(unixPath, "linux", unixExists) === join("/usr/local/bin", "pi"),
  "unix should resolve pi",
);
assert(
  resolvePiFromPathEnv(unixPath, "linux", () => false) === null,
  "missing binary should be null",
);

const found = checkPiCli(unixPath, "linux", unixExists);
assert(found.ok === true, "checkPiCli ok when pi present");
assert(found.canInstall === true, "canInstall when npm present");
assert(found.piPath === join("/usr/local/bin", "pi"), "piPath set");

const missingBoth = checkPiCli("/empty", "linux", () => false);
assert(missingBoth.ok === false, "missing pi → not ok");
assert(missingBoth.canInstall === false, "no npm → cannot install");
assert(missingBoth.piPath === null, "piPath null");

const npmOnly = (p: string) => p === join("/opt/bin", "npm");
const missingPi = checkPiCli("/opt/bin", "linux", npmOnly);
assert(missingPi.ok === false, "npm only → not ok");
assert(missingPi.canInstall === true, "npm only → can install");
assert(missingPi.message.includes("未检测到"), "message mentions missing CLI");

const cmdOpts = spawnOptsForCli(join("C:\\npm", "pi.cmd"));
if (process.platform === "win32") {
  assert(cmdOpts.shell === true, "win32 .cmd spawn must use shell");
} else {
  // Helper still inspects process.platform; on non-Windows CI shell stays false.
  assert(cmdOpts.shell === false, "non-win32 .cmd path does not force shell");
}
assert(
  spawnOptsForCli("/usr/local/bin/pi").shell === false,
  "unix binary does not force shell",
);

const spacedNpm = join("C:\\Program Files\\nodejs", "npm.cmd");
assert(
  quoteWinCmdArg(spacedNpm) === `"${spacedNpm}"`,
  "paths with spaces must be quoted for cmd.exe",
);
assert(
  quoteWinCmdArg(join("C:\\npm", "npm.cmd")) === join("C:\\npm", "npm.cmd"),
  "paths without spaces stay unquoted",
);
assert(
  quoteWinCmdArg('say "hi"') === '"say ""hi"""',
  "embedded quotes are doubled for cmd.exe",
);

console.log("test-pi-cli: ok");
