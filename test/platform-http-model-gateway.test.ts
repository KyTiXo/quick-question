import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import { renderPrompt } from "@/domain/prompt"
import { requestJson } from "@/platform/http"
import { ModelError } from "@/schema/errors"
import { OllamaGenerateResponse, OpenAiChatResponse } from "@/schema/http"
import { ModelGateway } from "@/services/model-gateway"

import { fetchLayer } from "./support"

const openAiConfig = {
  question: "q",
  provider: "openai" as const,
  model: "gpt-test",
  host: "https://api.example.com",
  apiKey: "sk-test",
  timeoutMs: 100,
  thinking: false,
}

const ollamaConfig = {
  ...openAiConfig,
  provider: "ollama" as const,
  host: "http://localhost:11434",
  apiKey: "",
  thinking: true,
}

describe("platform/http + services/model-gateway", () => {
  it("handles requestJson success and failure cases", async () => {
    await expect(
      Effect.runPromise(
        requestJson({
          url: new URL("https://example.com"),
          body: { hello: "world" },
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(
            fetchLayer(
              async () => new Response(JSON.stringify({ response: "ok" }), { status: 200 })
            )
          )
        )
      )
    ).resolves.toEqual({ response: "ok" })

    await expect(
      Effect.runPromise(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(
            fetchLayer(async () => {
              throw new Error("offline")
            })
          )
        )
      )
    ).rejects.toBeInstanceOf(ModelError)

    await expect(
      Effect.runPromise(
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
              async () =>
                ({
                  ok: true,
                  text: async () => {
                    throw new Error("broken text")
                  },
                }) as unknown as Response
            )
          )
        )
      )
    ).rejects.toThrow("Failed reading provider response.")

    await expect(
      Effect.runPromise(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(Effect.provide(fetchLayer(async () => new Response("not-json", { status: 200 }))))
      )
    ).rejects.toThrow("Provider returned invalid JSON.")

    await expect(
      Effect.runPromise(
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
              async () =>
                new Response(JSON.stringify({ nope: true }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                })
            )
          )
        )
      )
    ).rejects.toBeInstanceOf(ModelError)

    await expect(
      Effect.runPromise(
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
              async () =>
                new Response(JSON.stringify({ error: "missing" }), {
                  status: 500,
                  headers: { "content-type": "application/json" },
                })
            )
          )
        )
      )
    ).rejects.toBeInstanceOf(ModelError)

    await expect(
      Effect.runPromise(
        requestJson({
          url: new URL("https://example.com"),
          body: {},
          timeoutMs: 100,
          schema: OllamaGenerateResponse,
          module: "qq",
          method: "ollama",
        }).pipe(
          Effect.provide(fetchLayer(async () => new Response("bad gateway", { status: 502 })))
        )
      )
    ).rejects.toBeInstanceOf(ModelError)
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

    const gateway = await Effect.runPromise(ModelGateway.make)
    const prompt = [{ role: "user", content: "hello" }] as const

    await expect(
      Effect.runPromise(
        gateway.generateText({ config: openAiConfig, prompt }).pipe(Effect.provide(layer))
      )
    ).resolves.toBe("openai answer")
    await expect(
      Effect.runPromise(
        gateway.generateText({ config: ollamaConfig, prompt }).pipe(Effect.provide(layer))
      )
    ).resolves.toBe("ollama answer")

    expect(calls[0]?.url).toContain("/v1/chat/completions")
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-test")
    expect(calls[0]?.body).toContain(renderPrompt(prompt).replace("\n", "\\n"))
    expect(calls[1]?.url).toContain("/api/generate")
    expect(calls[1]?.body).toContain('"think":true')
  })

  it("rejects empty provider responses", async () => {
    const gateway = await Effect.runPromise(ModelGateway.make)
    const prompt = [{ role: "user", content: "hello" }] as const

    await expect(
      Effect.runPromise(
        gateway
          .generateText({ config: openAiConfig, prompt })
          .pipe(
            Effect.provide(
              fetchLayer(
                async () =>
                  new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }))
              )
            )
          )
      )
    ).rejects.toThrow("OpenAI returned an empty response.")

    await expect(
      Effect.runPromise(
        gateway
          .generateText({ config: ollamaConfig, prompt })
          .pipe(
            Effect.provide(
              fetchLayer(async () => new Response(JSON.stringify({ response: "   " })))
            )
          )
      )
    ).rejects.toThrow("Ollama returned an empty response.")
  })

  it("exposes the live gateway layer and model error messages", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ModelGateway
      }).pipe(
        Effect.provide(ModelGateway.Live),
        Effect.provide(fetchLayer(async () => new Response(JSON.stringify({ response: "ok" }))))
      )
    )

    expect(service).toBeDefined()
    expect(new ModelGateway(undefined as never)).toBeInstanceOf(ModelGateway)
    expect(new ModelError({ detail: "model failed" }).message).toBe("model failed")
    expect(OpenAiChatResponse).toBeDefined()
  })
})
