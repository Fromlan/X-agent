import { homedir } from "node:os";
import { join } from "node:path";
import { isXAgentSessionPath, getXAgentSessionsRoot } from "../electron/agent/session-paths";

const root = getXAgentSessionsRoot();
const okPath = join(root, "abc123.jsonl");
const sibling = join(homedir(), ".pi", "agent", "x-agent", "sessions-evil", "x.jsonl");
const outside = join(homedir(), ".pi", "agent", "sessions", "x.jsonl");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(isXAgentSessionPath(okPath), "session under root should pass");
assert(!isXAgentSessionPath(sibling), "prefix sibling must fail");
assert(!isXAgentSessionPath(outside), "cli sessions must fail");
assert(!isXAgentSessionPath(root), "root itself must fail");
assert(!isXAgentSessionPath(""), "empty must fail");

console.log("test-session-paths: ok");
