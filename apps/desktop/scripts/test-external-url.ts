import assert from "node:assert/strict";
import { validateExternalHttpUrl } from "../electron/agent/external-url.ts";

assert.equal(validateExternalHttpUrl("https://github.com/Fromlan/X-agent").ok, true);
assert.equal(validateExternalHttpUrl("http://example.com/docs").ok, true);
assert.equal(validateExternalHttpUrl("file:///etc/passwd").ok, false);
assert.equal(validateExternalHttpUrl("javascript:alert(1)").ok, false);
assert.equal(validateExternalHttpUrl("https://localhost/admin").ok, false);
assert.equal(validateExternalHttpUrl("http://127.0.0.1:9222").ok, false);
assert.equal(validateExternalHttpUrl("http://169.254.169.254/latest").ok, false);
assert.equal(validateExternalHttpUrl("http://192.168.1.1/").ok, false);
assert.equal(validateExternalHttpUrl("http://10.0.0.5/").ok, false);
assert.equal(validateExternalHttpUrl("").ok, false);

console.log("test-external-url: ok");
