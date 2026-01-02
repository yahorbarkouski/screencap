# Local LLM (Ollama / LM Studio) Setup

Screencap can classify events using a local model exposed via an OpenAI-compatible HTTP API.

This integration is currently **text-only**:

- Inputs: **context metadata + OCR text**
- Not used: screenshot pixels (no vision / multimodal payloads yet)

## How it works

The classification router tries, in order:

1. Cache reuse by `(stableHash, contextKey)` (no OCR/LLM)
2. Local retrieval from your history (no LLM)
3. Local HTTP LLM (this doc)
4. Cloud text (OpenRouter)
5. Cloud vision (enabled by default; can be disabled)
6. Fallback baseline

For steps 3–4, Screencap always provides:

- Context: `appBundleId`, `appName`, `windowTitle`, `urlHost`, `contentKind`, `contentTitle`
- OCR: `ocr_text` extracted locally using macOS Vision

## Requirements

- A local server that implements `POST /v1/chat/completions` (OpenAI-compatible)
- A model that can reliably output JSON when instructed

## Configure Screencap

In **Settings → AI → Local LLM (Ollama / LM Studio)**:

- Enable **Local LLM**
- Set **Base URL**
  - Ollama: `http://localhost:11434/v1`
  - LM Studio: `http://localhost:1234/v1` (depends on your server settings)
- Set **Model**
  - Must match what your server expects (often visible in `/v1/models`)
- Use **Test**

## Ollama example

1. Install and run Ollama.
2. Pull a model and ensure the OpenAI-compatible API is available.
3. Set in Screencap:
   - Base URL: `http://localhost:11434/v1`
   - Model: a model name returned by `GET /v1/models`

Quick check:

```bash
curl -s http://localhost:11434/v1/models | head
```

## LM Studio example

1. Start the local server in LM Studio (OpenAI-compatible mode).
2. Set in Screencap:
   - Base URL: whatever LM Studio shows (commonly `http://localhost:1234/v1`)
   - Model: the served model id/name

Quick check:

```bash
curl -s http://localhost:1234/v1/models | head
```

## Troubleshooting

### “Local LLM is disabled”

Enable it in Settings → AI.

### Connection refused / timeout

- The local server is not running, or the port is wrong.
- Verify the base URL and that `/v1/models` responds.

### “No JSON found in response”

Your local model returned non-JSON text. Use a stronger instruction-tuned model, or a model that is known to follow structured-output prompts.

### Poor accuracy

Local classification is driven mostly by OCR + context. Accuracy depends heavily on:

- OCR quality (fonts, contrast, language)
- Window titles / URL hosts / content titles
- Model capability

If you need higher accuracy and you accept image upload, keep **Allow vision uploads** enabled (Settings → AI).

## Vision-capable local models

Some local models are multimodal, but Screencap does not send images to the local endpoint yet. If you want local vision support, it requires a dedicated provider that sends OpenAI-style `image_url` parts and a runtime that supports them.

