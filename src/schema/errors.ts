import * as Schema from "effect/Schema"
export class UsageError extends Schema.ErrorClass<UsageError>("qq/UsageError")({
  _tag: Schema.tag("UsageError"),
  detail: Schema.String,
  exitCode: Schema.Number,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.detail
  }
}

export class ConfigStoreError extends Schema.ErrorClass<ConfigStoreError>("qq/ConfigStoreError")({
  _tag: Schema.tag("ConfigStoreError"),
  detail: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.detail
  }
}

export class ModelError extends Schema.ErrorClass<ModelError>("qq/ModelError")({
  _tag: Schema.tag("ModelError"),
  detail: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.detail
  }
}

export class DistillError extends Schema.ErrorClass<DistillError>("qq/DistillError")({
  _tag: Schema.tag("DistillError"),
  detail: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.detail
  }
}
