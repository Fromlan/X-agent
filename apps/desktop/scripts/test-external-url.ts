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

// IPv4-mapped IPv6 must be treated as the embedded IPv4 (SSRF bypass):
assert.equal(validateExternalHttpUrl("http://[::ffff:127.0.0.1]:8080/").ok, false);
assert.equal(validateExternalHttpUrl("http://[::ffff:7f00:1]/").ok, false, "mapped hex loopback");
assert.equal(validateExternalHttpUrl("http://[::ffff:a00:1]/").ok, false, "mapped hex 10.0.0.1");
assert.equal(validateExternalHttpUrl("http://[::ffff:7f00:1%25eth0]/").ok, false, "zone-id rejected");

// DNS-rebinding hostnames that resolve to loopback/private must be blocked:
assert.equal(validateExternalHttpUrl("https://localtest.me/x").ok, false);
assert.equal(validateExternalHttpUrl("https://127.0.0.1.nip.io/").ok, false);
assert.equal(validateExternalHttpUrl("https://foo.sslip.io/").ok, false);

console.log("test-external-url: ok");
