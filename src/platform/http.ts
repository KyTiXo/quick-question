import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { AiError } from "effect/unstable/ai"
import { ModelError } from "@/schema/errors"

const toModelError = (description: string, cause?: unknown) =>
  new ModelError({ detail: description, cause })

const parseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => toModelError("Provider returned invalid JSON.", cause),
  })

export const requestJson = <S extends Schema.Top>({
  url,
  headers,
  body,
  timeoutMs,
  schema,
  module,
  method,
}: {
  url: URL
  headers?: Record<string, string>
  body: unknown
  timeoutMs: number
  schema: S
  module: string
  method: string
}) =>
  Effect.gen(function* () {
    const fetch = yield* BunHttpClient.Fetch
    const response = yield* Effect.tryPromise({
      try: () => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        return fetch(
          new Request(url.toString(), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        ).finally(() => {
          clearTimeout(timeout)
        })
      },
      catch: (cause) => {
        const aiError = AiError.make({
          module,
          method,
          reason: new AiError.UnknownError({
            description: "Request failed before receiving a response.",
          }),
        })

        return toModelError(aiError.message, cause)
      },
    })
    const rawText = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => toModelError("Failed reading provider response.", cause),
    })

    if (!response.ok) {
      const body = yield* parseJson(rawText).pipe(Effect.orElseSucceed(() => rawText))
      const aiError = AiError.make({
        module,
        method,
        reason: AiError.reasonFromHttpStatus({
          status: response.status,
          body,
        }),
      })

      return yield* toModelError(aiError.message, body)
    }

    const payload = yield* parseJson(rawText)

    return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
      Effect.mapError((cause) => {
        const aiError = AiError.make({
          module,
          method,
          reason: AiError.InvalidOutputError.fromSchemaError(cause),
        })

        return toModelError(aiError.message, payload)
      })
    )
  })
