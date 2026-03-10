<div align="center">

<h1>Quick Question LLM</h1>

<p><strong>Compress noisy command output before handing it to your LLM.</strong></p>

<p>Tests, diffs, logs, stack traces - thousands of tokens your agent never needed.<br/>
<code>qq</code> distills them down to what matters. Save up to <strong>~99% of tokens</strong>.</p>

<br/>

[![CI](https://github.com/KyTiXo/quick-question/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/KyTiXo/quick-question/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/KyTiXo/quick-question/badges/qq-tests.json)](https://github.com/KyTiXo/quick-question/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/KyTiXo/quick-question/badges/qq-coverage.json)](https://github.com/KyTiXo/quick-question/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun&logoColor=black)](https://bun.sh/)

<br/>

[![Ollama](https://img.shields.io/badge/provider-Ollama-333?logo=ollama&logoColor=white)](#providers)
[![OpenAI](https://img.shields.io/badge/provider-OpenAI-412991?logo=openai&logoColor=white)](#providers)
[![Local](https://img.shields.io/badge/provider-Local_GGUF-green)](#local-provider)
[![Token savings](https://img.shields.io/badge/token_savings-~99%25-ff6f00)](#why-qq)

</div>

---

> **What's new in 0.1.7** - All-in-one **local provider** powered by `node-llama-cpp` with automatic GGUF model download. No Ollama required, no cloud account, no API key - just `qq config provider local` and go. Watch mode now summarizes **only the delta** between cycles instead of re-summarizing the full stream, and per-provider model config means switching between `ollama`, `openai`, and `local` always restores your last-saved model.

---

## Features

- **Token compression** - distill verbose command output into tight, signal-only summaries
- **Three providers** - `ollama` (default), `openai` (any compatible API), and `local` (built-in `node-llama-cpp`)
- **No cloud required** - Ollama and local modes run entirely on your machine, no API key needed
- **Watch mode** - repeating output from `watch`/`tail -f` is delta-summarized, not re-summarized every cycle
- **Interactive passthrough** - `[Y/N]`, `Password:`, and other prompts pass through raw, no LLM involvement
- **Bad-summary fallback** - if the model produces a poor summary, the original input passes through unchanged
- **Per-provider model config** - `qq config model` is tracked per provider, so switching providers restores your last model choice
- **Machine-readable progress** - `QQ_PROGRESS_PROTOCOL=stderr` for structured markers in CI or agent harnesses
- **Built with Effect** - typed errors, resource safety, and composable services end to end

## Why `qq`

Command output is one of the biggest sources of token waste in AI-assisted workflows. A full test run, a large `git diff`, or a recursive `rg` search can easily hit tens of thousands of tokens. Your agent doesn't need all of that - it needs an answer.

```bash
rg -n "auth|session|token" src/ | qq "where is authentication handled?"
```

| | Tokens | Characters |
|---|---|---|
| **Before** | ~6,400 | ~25,600 |
| **After** | ~80 | ~320 |
| **Saved** | **~99%** | **~99%** |

The numbers vary by input, but the pattern is consistent: noisy command output compresses aggressively. Short, targeted questions compress even more.

`qq` is built around [Qwen 3.5](https://qwenlm.github.io/blog/qwen3/) - a model family so good at compression and summarization that the **2B variant runs on nearly any computer**. No GPU required. If your machine can run a browser, it can run `qq`.

## Install

### npm (recommended)

```bash
npm install -g quick-question-llm
```

Verify it works:

```bash
echo "hello world" | qq "what does this say?"
```

### Bun

```bash
bun add -g quick-question-llm
```

If you plan to use the `local` provider, trust the native dependency:

```bash
bun pm trust node-llama-cpp
```

### Without installing

```bash
npx quick-question-llm --help
```

> Standalone binaries can be built locally with `bun run build:all`, but the npm package is the primary distribution path.

## Quick Start

Pipe any command's output through `qq` with a short question:

```bash
# Did the tests pass?
bun test 2>&1 | qq "did the tests pass?"

# What changed in this diff?
git diff | qq "what changed?"

# Where is auth handled?
rg -n "auth|session|token" src/ | qq "where is authentication handled?"

# Is this safe to apply?
terraform plan 2>&1 | qq "is this safe to apply?"
```

Instead of dumping 2,000 lines of test output into your agent, you get something like:

```
3 tests failed: auth.test.ts lines 42, 78, 91
```

Twelve words instead of two thousand lines.

## Providers

`qq` supports three providers. Ollama is the default.

### Ollama (default)

Runs locally via Ollama. Free, private, no account needed.

```bash
ollama pull qwen3.5:2b    # make sure ollama serve is running
git diff | qq "what changed?"
```

### OpenAI

Works with OpenAI or any OpenAI-compatible API (Groq, LM Studio, Together, etc.):

```bash
git log --oneline -50 | qq --provider openai --model gpt-4o-mini --api-key sk-... "summarize recent work"
```

### Switching and persisting providers

```bash
# Switch to OpenAI and save credentials
qq config provider openai
qq config api-key "sk-..."
qq config model "gpt-4o-mini"

# Switch to local - your OpenAI model is remembered
qq config provider local

# Switch back - OpenAI model restored automatically
qq config provider openai

# Other useful config
qq config max-tokens 400
qq config thinking false
```

`qq config model` is tracked **per provider**, so switching between `ollama`, `openai`, and `local` always restores the last model you set for that provider.

View the current effective config at any time:

```bash
qq config
```

## Local Provider

The `local` provider runs models directly via [`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp) - no Ollama install, no server process, no cloud account.

```bash
qq config provider local
git diff | qq "what changed?"
```

On first run, `qq` automatically downloads the default model:

```
hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf
```

You can point to any GGUF model on Hugging Face:

```bash
qq config model "hf:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf"
```

**Local provider notes:**

- Models are cached under your qq config directory, typically `~/.config/qq/models`
- `host` and `api-key` flags are ignored for the local provider
- `max-tokens` defaults to `200` and applies across all providers
- If you installed with Bun and local startup fails, run `bun pm trust node-llama-cpp` and retry

## Agent / AI Workflow Usage

Add this to your Codex, Claude Code, OpenCode, or Cursor agent instructions:

```
When running shell commands whose output may be long (tests, builds, diffs, logs), pipe
the output through `qq` with a short question rather than capturing the raw output.
Examples:
  bun test 2>&1 | qq "did the tests pass?"
  git diff HEAD~1 | qq "summarize the changes"
  terraform plan 2>&1 | qq "is this safe to apply?"
This reduces token usage and keeps context focused.
```

For agent harnesses and CI pipelines, enable machine-readable progress markers:

```bash
QQ_PROGRESS_PROTOCOL=stderr bun test 2>&1 | qq "did the tests pass?"
```

This emits structured `__QQ_PROGRESS__:phase:collecting`, `__QQ_PROGRESS__:phase:summarizing`, and `__QQ_PROGRESS__:stop` markers on stderr.

## Behavior Notes

- **Watch mode** - repeating `watch`/`tail -f` output is detected automatically. Only the delta between cycles is summarized, not the full dump every time.
- **Interactive passthrough** - `[Y/N]`, `Password:`, and similar prompts are forwarded raw with no LLM involvement.
- **Bad-summary fallback** - if the model response is longer than the input or looks like a refusal, the original input passes through unchanged.
- **Thinking mode** - toggle extended model reasoning with `qq config thinking true/false` or `--thinking true`.

## Development

`qq` is developed with [Bun](https://bun.sh/) and [Effect](https://effect.website/).

```bash
git clone https://github.com/KyTiXo/quick-question.git
cd quick-question
bun install
```

Run the full check suite (format, typecheck, lint, test):

```bash
bun run check:all:qq
```

Build the distributable package:

```bash
bun run build
```

Build standalone binaries for all platforms:

```bash
bun run build:all
```

Manual smoke tests:

```bash
bun run test:live
bun run test:explode
```

## Contributing

Contributions are welcome. Please open an issue to discuss larger changes before submitting a PR.

```bash
# Fork, clone, branch
bun install
# Make your changes
bun run check:all:qq    # must pass before submitting
```

---

<div align="center">
<br/>
<strong>Stop wasting tokens. Start asking quick questions.</strong>
<br/><br/>
<code>npm install -g quick-question-llm</code>
<br/><br/>
</div>
