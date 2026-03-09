import { Schema } from "effect"

export const OllamaGenerateRequest = Schema.Struct({
  model: Schema.String,
  prompt: Schema.String,
  stream: Schema.Boolean,
  think: Schema.Boolean,
  options: Schema.Struct({
    temperature: Schema.Number,
    num_predict: Schema.Number,
  }),
})
export type OllamaGenerateRequest = Schema.Schema.Type<typeof OllamaGenerateRequest>

export const OllamaGenerateResponse = Schema.Struct({
  response: Schema.String,
})
export type OllamaGenerateResponse = Schema.Schema.Type<typeof OllamaGenerateResponse>

export const OpenAiChatRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      content: Schema.String,
    })
  ),
  temperature: Schema.Number,
  max_tokens: Schema.Number,
})
export type OpenAiChatRequest = Schema.Schema.Type<typeof OpenAiChatRequest>

export const OpenAiChatResponse = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.String,
      }),
    })
  ),
})
export type OpenAiChatResponse = Schema.Schema.Type<typeof OpenAiChatResponse>
