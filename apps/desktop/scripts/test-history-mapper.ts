import { messagesToHistory } from "../electron/agent/history";

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

const items = messagesToHistory(sample);
console.log(JSON.stringify(items, null, 2));
if (items.length !== 4) throw new Error(`expected 4 items, got ${items.length}`);
if (items[0].kind !== "user" || items[0].text !== "你好") throw new Error("user");
if (items[1].kind !== "assistant" || !items[1].text.includes("你好")) throw new Error("asst");
if (items[2].kind !== "tool" || items[2].toolName !== "ls" || !items[2].done) throw new Error("tool");
if (items[3].kind !== "assistant") throw new Error("asst2");
console.log("history mapper ok");
