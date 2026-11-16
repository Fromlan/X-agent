/** Exercise attachment upload timing, retry caching and chat-switch guards without browser or network access. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareDeepSeekAttachments } from "./deepseek-file-attachments";
import { splitFilesForAttachment } from "./file-attachment";

const model = { provider: "official", id: "deepseek-flash", name: "Flash", deepseekChatbot: true };
const uploadedDocument = { id: "file-api-fixture", name: "report.pdf", purpose: "rich_layout_recognition", provider: model.provider, authScope: "a".repeat(64) };
let pendingReads: Array<() => void>;
let upload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pendingReads = [];
  upload = vi.fn(async () => ({ ok: true, document: uploadedDocument }));
  vi.stubGlobal("window", { xAgent: { files: { deepseekUpload: upload } } });
  vi.stubGlobal("FileReader", class {
    result = "";
    onload?: () => void;
    onerror?: () => void;
    /** Resolve only when the test advances I/O, so a chat switch can occur during the read. */
    readAsDataURL(): void {
      pendingReads.push(() => { this.result = "data:application/pdf;base64,cGRm"; this.onload?.(); });
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek document composer", () => {
  it("marks rich documents and text conversions only for the eligible model", async () => {
    const file = new File(["pdf"], "report.pdf");
    const sheet = new File(["xlsx"], "data.xlsx");
    const items = [file, sheet].map((file) => ({ file, absPath: file.name }));
    const ordinary = await splitFilesForAttachment(items);
    expect(ordinary.references.every((ref) => !ref.deepseekFile)).toBe(true);
    const eligible = await splitFilesForAttachment(items, { deepseek: true });
    expect(eligible.references.map((ref) => ref.deepseekPurpose)).toEqual(["rich_layout_recognition", "user_data"]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not upload documents after switching to an unsupported model", async () => {
    const file = new File(["pdf"], "report.pdf");
    await expect(prepareDeepSeekAttachments([{ absPath: "report.pdf", displayName: "report.pdf", deepseekFile: file }], { ...model, deepseekChatbot: false })).rejects.toThrow("切回");
    expect(upload).not.toHaveBeenCalled();
  });

  it("revalidates successful cached parses in main for each send and binds delayed requests to their chat", async () => {
    const file = new File(["pdf"], "report.pdf");
    const refs = [{ absPath: "report.pdf", displayName: "report.pdf", deepseekFile: file }];
    const scope = { sessionId: "original-chat", isCurrent: () => true };
    const first = prepareDeepSeekAttachments(refs, model, scope);
    pendingReads.shift()!();
    expect((await first).blocks.join("")).toContain(uploadedDocument.id);
    expect(upload).toHaveBeenLastCalledWith(expect.objectContaining({ expectedSessionId: "original-chat", cachedDocument: undefined }));
    const retry = prepareDeepSeekAttachments(refs, model, scope);
    pendingReads.shift()!();
    await retry;
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenLastCalledWith(expect.objectContaining({ cachedDocument: uploadedDocument }));
  });

  it("cancels before upload if FileReader completes after a chat switch", async () => {
    const file = new File(["pdf"], "report.pdf");
    let current = true;
    const task = prepareDeepSeekAttachments([{ absPath: file.name, displayName: file.name, deepseekFile: file }], model, { sessionId: "old", isCurrent: () => current });
    current = false;
    pendingReads.shift()!();
    await expect(task).rejects.toThrow("会话或模型已切换");
    expect(upload).not.toHaveBeenCalled();
  });
});
