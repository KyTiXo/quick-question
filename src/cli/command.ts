import { Argument, Command, Flag } from "effect/unstable/cli"
import { handleConfig, handleRun } from "@/cli/handlers"

const sharedFlags = {
  provider: Flag.optional(
    Flag.string("provider").pipe(Flag.withDescription("LLM provider: ollama, openai, or local"))
  ),
  model: Flag.optional(Flag.string("model").pipe(Flag.withDescription("Model name"))),
  host: Flag.optional(
    Flag.string("host").pipe(Flag.withDescription("API base URL (ignored for local)"))
  ),
  apiKey: Flag.optional(
    Flag.string("api-key").pipe(
      Flag.withDescription("API key for openai provider (ignored for local)")
    )
  ),
  timeoutMs: Flag.optional(
    Flag.string("timeout-ms").pipe(Flag.withDescription("Request timeout in milliseconds"))
  ),
  maxTokens: Flag.optional(
    Flag.string("max-tokens").pipe(Flag.withDescription("Maximum tokens to generate"))
  ),
  thinking: Flag.optional(
    Flag.string("thinking").pipe(Flag.withDescription("Enable or disable model thinking"))
  ),
}

const configCommand = Command.make("config", {
  key: Argument.optional(
    Argument.string("key").pipe(Argument.withDescription("Config key to read or set"))
  ),
  value: Argument.string("value").pipe(
    Argument.variadic(),
    Argument.withDescription("Config value to persist")
  ),
}).pipe(
  Command.withDescription("Show, get, or set persisted qq config."),
  Command.withExamples([
    { command: 'qq config model "qwen3.5:2b"' },
    { command: "qq config max-tokens 400" },
    { command: "qq config thinking false" },
    { command: "qq config" },
  ]),
  Command.withHandler(handleConfig)
)

export const qqCommand = Command.make("qq", {
  question: Argument.string("question").pipe(
    Argument.variadic(),
    Argument.withDescription("Question to ask about stdin")
  ),
}).pipe(
  Command.withDescription("Compress command output before handing it to another LLM."),
  Command.withExamples([
    { command: 'git diff | qq "what changed?"' },
    { command: 'bun test 2>&1 | qq "did the tests pass?"' },
    { command: 'qq config model "qwen3.5:2b"' },
  ]),
  Command.withSharedFlags(sharedFlags),
  Command.withHandler(handleRun),
  Command.withSubcommands([configCommand])
)
