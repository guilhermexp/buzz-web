// SYNTHETIC test double: a deterministic, loopback-only, OpenAI-compatible chat endpoint used
// for live checks of contained agents without a real model provider. It never calls a model.
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.STUB_LLM_PORT || "47411", 10);
let served = 0;

function lastUserText(messages) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join(" ");
    }
  }
  return "";
}

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", `http://${host}`).pathname;
  if (request.method === "GET" && path === "/v1/models") {
    send(response, 200, { object: "list", data: [{ id: "buzz-synthetic-echo", object: "model" }] });
    return;
  }
  if (request.method !== "POST" || path !== "/v1/chat/completions") {
    send(response, 404, { error: { message: "not found" } });
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    send(response, 400, { error: { message: "invalid JSON" } });
    return;
  }
  served += 1;
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const userText = lastUserText(messages);
  const usage = { prompt_tokens: userText.length, completion_tokens: 16, total_tokens: userText.length + 16 };
  const reply = (message, finishReason) => {
    console.log(`[stub-llm] completion #${served} model=${input.model} -> ${finishReason}`);
    send(response, 200, {
      id: `synthetic-${served}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: input.model ?? "buzz-synthetic-echo",
      choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }],
      usage,
    });
  };
  // Turn shape mirrors a real model: first answer the mention by running the documented
  // `buzz messages send` command through the shell tool, then finish once its result is back.
  const shellTool = (input.tools ?? [])
    .map((tool) => tool?.function?.name)
    .find((name) => typeof name === "string" && /(^|[_.:-])shell$/.test(name));
  const lastRole = messages.at(-1)?.role;
  const replyTo = /--reply-to ([0-9a-f]{64})/.exec(userText)?.[1];
  const channel = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.exec(userText)?.[0];
  if (shellTool && lastRole !== "tool" && replyTo && channel) {
    const command = `buzz messages send --channel ${channel} --reply-to ${replyTo} --content "[synthetic stub LLM] automated reply"`;
    reply(
      {
        content: null,
        tool_calls: [
          { id: `call_synthetic_${served}`, type: "function", function: { name: shellTool, arguments: JSON.stringify({ command }) } },
        ],
      },
      "tool_calls",
    );
    return;
  }
  reply({ content: "[synthetic stub LLM] done" }, "stop");
}).listen(port, host, () => console.log(`[stub-llm] SYNTHETIC OpenAI-compatible stub on http://${host}:${port}/v1`));
