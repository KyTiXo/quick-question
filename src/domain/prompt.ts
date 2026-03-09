import { Prompt } from "effect/unstable/ai"

const textFromPart = (part: Prompt.Part) => {
  switch (part.type) {
    case "text":
      return part.text
    case "reasoning":
      return part.text
    case "file":
      return `[file ${part.fileName ?? part.mediaType}]`
    case "tool-call":
      return `[tool-call ${part.name}]`
    case "tool-result":
      return `[tool-result ${part.name}]`
    case "tool-approval-request":
      return "[tool-approval-request]"
    case "tool-approval-response":
      return "[tool-approval-response]"
  }
}

const renderMessage = (message: Prompt.Message) =>
  typeof message.content === "string"
    ? `${message.role.toUpperCase()}:\n${message.content}`
    : `${message.role.toUpperCase()}:\n${message.content.map(textFromPart).join("\n")}`

export const renderPrompt = (input: Prompt.RawInput) =>
  Prompt.make(input).content.map(renderMessage).join("\n\n")

export const buildBatchPrompt = (question: string, input: string) =>
  Prompt.make([
    {
      role: "system",
      content: [
        "You compress command output for another paid language model.",
        "Rules:",
        "- Answer only what the question asks.",
        "- Use the same language as the question.",
        "- No markdown.",
        "- Keep the answer extremely short (but complete) unless explicitly asked to elaborate or not summarize.",
        "- Prefer one sentence. Never exceed three short lines.",
        "- Never ask for more input.",
        '- If the command output is insufficient, reply only with "quick-question: Insufficient information to output anything." in the same language as the question.',
        "- If the source is already shorter than your answer would be, prefer a minimal answer or reuse the source wording.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Question: ${question}\n\nCommand output:\n${input}`,
        },
      ],
    },
  ])

export const buildWatchPrompt = (question: string, previousCycle: string, currentCycle: string) =>
  Prompt.make([
    {
      role: "system",
      content: [
        "You compare two consecutive watch-mode command cycles for another paid language model.",
        "Rules:",
        "- Answer only what the question asks.",
        "- Focus on what changed from the previous cycle to the current cycle.",
        "- Use the same language as the question.",
        "- No markdown.",
        "- Keep the answer extremely short (but complete) unless explicitly asked to elaborate or not summarize.",
        "- Prefer one sentence. Never exceed three short lines.",
        '- If nothing relevant changed, reply only with "No relevant change." in the same language as the question.',
        "- Never ask for more input.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Question: ${question}\n\nPrevious cycle:\n${previousCycle}\n\nCurrent cycle:\n${currentCycle}`,
        },
      ],
    },
  ])
