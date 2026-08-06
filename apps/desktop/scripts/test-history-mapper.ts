import {
  branchEntriesToHistory,
  extractMessageText,
  textFromContent,
} from "../shared/transcript/index.ts";

const sample = [
  {
    role: "user",
    content: [{ type: "text", text: "你好" }],
    timestamp: 1,
  },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "greet" },
      { type: "text", text: "你好！" },
      { type: "toolCall", id: "c1", name: "ls", arguments: { path: "." } },
    ],
    timestamp: 2,
  },
  {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "ls",
    content: [{ type: "text", text: "a.txt\nb.txt" }],
    timestamp: 3,
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "目录里有两个文件。" }],
    timestamp: 4,
  },
];

const branchItems = branchEntriesToHistory([
  {
    type: "message",
    id: "entry-user-1",
    message: sample[0],
  },
  {
    type: "message",
    id: "entry-asst-1",
    message: sample[1],
  },
  {
    type: "message",
    id: "entry-tool-1",
    message: sample[2],
  },
  {
    type: "message",
    id: "entry-asst-2",
    message: sample[3],
  },
  {
    type: "custom",
    id: "entry-custom",
  },
]);

if (branchItems[0]?.kind !== "user" || branchItems[0].entryId !== "entry-user-1") {
  throw new Error("branch user entryId");
}
if (branchItems[1]?.kind !== "assistant" || branchItems[1].entryId !== "entry-asst-1") {
  throw new Error("branch asst entryId");
}
if (branchItems[1].kind === "assistant" && branchItems[1].userEntryId !== "entry-user-1") {
  throw new Error("branch asst userEntryId");
}
if (branchItems[3]?.kind !== "assistant" || branchItems[3].userEntryId !== "entry-user-1") {
  throw new Error("branch asst2 userEntryId");
}

const extracted = extractMessageText({
  role: "user",
  content: [{ type: "text", text: "  hi  " }],
});
if (extracted !== "hi") throw new Error(`extractMessageText trim: ${extracted}`);
if (textFromContent([{ type: "text", text: "a" }, { type: "text", text: "b" }]) !== "ab") {
  throw new Error("textFromContent join");
}

console.log("history mapper ok");
