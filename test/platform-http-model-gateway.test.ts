import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { renderPrompt } from "@/domain/prompt"
import { requestJson } from "@/platform/http"
import { ModelError } from "@/schema/errors"
import { OllamaGenerateResponse, OpenAiChatResponse } from "@/schema/http"
import { LocalLlama } from "@/services/local-llama"
import { ModelGateway } from "@/services/model-gateway"

import { fetchLayer, getEffectError } from "./support"

const openAiConfig = {
  question: "q",
  provider: "openai" as const,
  model: "gpt-test",
  host: "https://api.example.com",
  apiKey: "sk-test",
  timeoutMs: 100,
  maxTokens: 200,
  thinking: false,
}

const ollamaConfig = {
  ...openAiConfig,
  provider: "ollama" as const,
  host: "http://localhost:11434",
  apiKey: "",
  thinking: true,
}

const localConfig = {
  ...openAiConfig,
  provider: "local" as const,
  model: "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf",
  host: "",
  apiKey: "",
}

const localLlamaLayer = (
  generateText: typeof LocalLlama.Service.generateText = () => Effect.succeed("local answer")
) =>
  Layer.succeed(LocalLlama)({
    generateText,
  } satisfies typeof LocalLlama.Service)

describe("platform/http + services/model-gateway", () => {
  it("handles requestJson success and failure cases", async () => {
    expect(
      await Effect.runPromise(
        requestJson({
          url: new URL("https://example.com"),
          body: { hello: "world" },
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(
            fetchLayer(() => new Response(JSON.stringify({ response: "ok" }), { status: 200 }))
          )
        )
      )
    ).toEqual({ response: "ok" })

    expect(
      await getEffectError(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(
            fetchLayer(() => {
              throw new Error("offline")
            })
          )
        )
      )
    ).toBeInstanceOf(ModelError)

    const brokenTextError = await getEffectError(
      requestJson({
        url: new URL("https://example.com"),
        body: {},
        timeoutMs: 100,
        schema: OllamaGenerateResponse,
        module: "qq",
        method: "ollama",
      }).pipe(
        Effect.provide(
          fetchLayer(
            () =>
              ({
                ok: true,
                text: () => Promise.reject(new Error("broken text")),
              }) as unknown as Response
          )
        )
      )
    )
    expect((brokenTextError as Error).message).toBe("Failed reading provider response.")

    const invalidJsonError = await getEffectError(
      requestJson({
        url: new URL("https://example.com"),
        body: {},
        timeoutMs: 100,
        schema: OllamaGenerateResponse,
        module: "qq",
        method: "ollama",
      }).pipe(Effect.provide(fetchLayer(() => new Response("not-json", { status: 200 }))))
    )
    expect((invalidJsonError as Error).message).toBe("Provider returned invalid JSON.")

    expect(
      await getEffectError(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(
            fetchLayer(
              () =>
                new Response(JSON.stringify({ nope: true }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                })
            )
          )
        )
      )
    ).toBeInstanceOf(ModelError)

    expect(
      await getEffectError(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(
            fetchLayer(
              () =>
                new Response(JSON.stringify({ error: "missing" }), {
                  status: 500,
                  headers: { "content-type": "application/json" },
                })
            )
          )
        )
      )
    ).toBeInstanceOf(ModelError)

    expect(
      await getEffectError(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(Effect.provide(fetchLayer(() => new Response("bad gateway", { status: 502 }))))
      )
    ).toBeInstanceOf(ModelError)
  })

  it("calls openai and ollama providers through the gateway", async () => {
    const calls: Array<{ url: string; body: string | null; headers: Headers }> = []
    const layer = fetchLayer(async (input) => {
      const request =
        input instanceof Request
          ? input
          : new Request(typeof input === "string" ? input : input.toString())
      const url = request.url
      const body = request.body ? await request.clone().text() : null

      calls.push({
        url,
        body,
        headers: new Headers(request.headers),
      })

      if (url.includes("/chat/completions")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: " openai answer " } }] })
        )
      }

      return new Response(JSON.stringify({ response: " ollama answer " }))
    })

    const gateway = await Effect.runPromise(
      ModelGateway.make.pipe(Effect.provide(localLlamaLayer()))
    )
    const prompt = [{ role: "user", content: "hello" }] as const

    expect(
      await Effect.runPromise(
        gateway.generateText({ config: openAiConfig, prompt }).pipe(Effect.provide(layer))
      )
    ).toBe("openai answer")
    expect(
      await Effect.runPromise(
        gateway.generateText({ config: ollamaConfig, prompt }).pipe(Effect.provide(layer))
      )
    ).toBe("ollama answer")

    expect(calls[0]?.url).toContain("/v1/chat/completions")
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-test")
    expect(calls[0]?.body).toContain(renderPrompt(prompt).replace("\n", "\\n"))
    expect(calls[0]?.body).toContain('"max_tokens":200')
    expect(calls[1]?.url).toContain("/api/generate")
    expect(calls[1]?.body).toContain('"think":true')
    expect(calls[1]?.body).toContain('"num_predict":200')
  })

  it("delegates local provider calls through the gateway", async () => {
    const prompt = [{ role: "user", content: "hello" }] as const
    const gateway = await Effect.runPromise(
      ModelGateway.make.pipe(
        Effect.provide(
          localLlamaLayer(({ model, prompt: rendered, timeoutMs, maxTokens }) => {
            expect(model).toBe(localConfig.model)
            expect(timeoutMs).toBe(100)
            expect(maxTokens).toBe(200)
            expect(rendered).toContain("hello")

            return Effect.succeed("local answer")
          })
        )
      )
    )

    expect(
      await Effect.runPromise(
        gateway
          .generateText({ config: localConfig, prompt })
          .pipe(
            Effect.provide(fetchLayer(() => new Response(JSON.stringify({ response: "unused" }))))
          )
      )
    ).toBe("local answer")
  })

  it("rejects empty provider responses", async () => {
    const gateway = await Effect.runPromise(
      ModelGateway.make.pipe(Effect.provide(localLlamaLayer()))
    )
    const prompt = [{ role: "user", content: "hello" }] as const

    const openAiError = await getEffectError(
      gateway
        .generateText({ config: openAiConfig, prompt })
        .pipe(
          Effect.provide(
            fetchLayer(
              () => new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }))
            )
          )
        )
    )
    expect((openAiError as Error).message).toBe("OpenAI returned an empty response.")

    const ollamaError = await getEffectError(
      gateway
        .generateText({ config: ollamaConfig, prompt })
        .pipe(Effect.provide(fetchLayer(() => new Response(JSON.stringify({ response: "   " })))))
    )
    expect((ollamaError as Error).message).toBe("Ollama returned an empty response.")

    const localGateway = await Effect.runPromise(
      ModelGateway.make.pipe(
        Effect.provide(
          localLlamaLayer(() => Effect.fail(new ModelError({ detail: "local failed" })))
        )
      )
    )

    const localError = await getEffectError(
      localGateway
        .generateText({ config: localConfig, prompt })
        .pipe(
          Effect.provide(fetchLayer(() => new Response(JSON.stringify({ response: "unused" }))))
        )
    )
    expect((localError as Error).message).toBe("local failed")
  })

  it("exposes the live gateway layer and model error messages", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ModelGateway
      }).pipe(
        Effect.provide(ModelGateway.Live),
        Effect.provide(localLlamaLayer()),
        Effect.provide(fetchLayer(() => new Response(JSON.stringify({ response: "ok" }))))
      )
    )

    expect(service).toBeDefined()
    expect(new ModelGateway(undefined as never)).toBeInstanceOf(ModelGateway)
    expect(new ModelError({ detail: "model failed" }).message).toBe("model failed")
    expect(OpenAiChatResponse).toBeDefined()
  })
})
