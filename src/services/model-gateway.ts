import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"
import type { Prompt } from "effect/unstable/ai"
import { renderPrompt } from "@/domain/prompt"
import { requestJson } from "@/platform/http"
import type { ResolvedRunConfig } from "@/schema/config"
import { ModelError } from "@/schema/errors"
import { OllamaGenerateResponse, OpenAiChatResponse } from "@/schema/http"

export class ModelGateway extends ServiceMap.Service<ModelGateway>()("ModelGateway", {
  make: Effect.succeed({
    generateText: ({ config, prompt }: { config: ResolvedRunConfig; prompt: Prompt.RawInput }) => {
      const renderedPrompt = renderPrompt(prompt)

      return config.provider === "openai"
        ? requestJson({
            url: new URL("/v1/chat/completions", `${config.host}/`),
            headers: {
              authorization: `Bearer ${config.apiKey}`,
            },
            body: {
              model: config.model,
              messages: [{ role: "user", content: renderedPrompt }],
              temperature: 0.1,
              max_tokens: 200,
            },
            timeoutMs: config.timeoutMs,
            schema: OpenAiChatResponse,
            module: "qq",
            method: "openai",
          }).pipe(
            Effect.flatMap((response) => {
              const content = response.choices[0]?.message.content?.trim()

              if (!content) {
                return Effect.fail(
                  new ModelError({
                    detail: "OpenAI returned an empty response.",
                  })
                )
              }

              return Effect.succeed(content)
            })
          )
        : requestJson({
            url: new URL("/api/generate", `${config.host}/`),
            body: {
              model: config.model,
              prompt: renderedPrompt,
              stream: false,
              think: config.thinking,
              options: {
                temperature: 0.1,
                num_predict: 80,
              },
            },
            timeoutMs: config.timeoutMs,
            schema: OllamaGenerateResponse,
            module: "qq",
            method: "ollama",
          }).pipe(
            Effect.flatMap((response) => {
              const content = response.response.trim()

              if (!content) {
                return Effect.fail(
                  new ModelError({
                    detail: "Ollama returned an empty response.",
                  })
                )
              }

              return Effect.succeed(content)
            })
          )
    },
  }),
}) {
  static Live = Layer.effect(this, this.make)
}
