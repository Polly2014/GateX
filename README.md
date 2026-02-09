# ⚡ GateX

**Your gateway to AI models** — Access VS Code LLM providers via a simple HTTP API.

Turn your GitHub Copilot subscription into a local AI API server. Use Claude, GPT-4o, Gemini, and more with any OpenAI or Anthropic SDK.

## ✨ Features

- 🚀 **Zero Configuration** — Starts automatically, default port `24680`
- 🔌 **Dual API Format** — OpenAI + Anthropic compatible endpoints
- 🌊 **SSE Streaming** — Real-time streaming responses
- 🔄 **Smart Retry** — Exponential backoff for transient failures
- 🎯 **Multi-Model Support** — Access Claude, GPT-4o, Gemini, and more
- ⚙️ **IDE Config Generator** — One-click setup for Claude Code, .env, etc.

## 🚀 Quick Start

### 1. Install & Activate

The extension starts automatically when VS Code opens. Look for the status bar item:

```
⚡ GateX :24680
```

### 2. Use in Your Code

**OpenAI Format:**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:24680/v1",
    api_key="gatex"  # Any value works
)

response = client.chat.completions.create(
    model="claude-sonnet-4",  # Or: gpt-4o, gpt-4o-mini, etc.
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

**Anthropic Format:**

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:24680",
    api_key="gatex"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for event in message:
    if event.type == "content_block_delta":
        print(event.delta.text, end="")
```

### 3. Configure Your IDE

Press `Cmd+Shift+P` (or `Ctrl+Shift+P`) → `GateX: Configure for IDE` to auto-generate configs for:

- **Claude Code** — Updates `.claude/settings.json` with dual model selection (main + fast), onboarding bypass, and telemetry opt-out
- **Codex CLI** — Generates `~/.codex/config.toml` with GateX as model provider
- **.env File** — Generates both OpenAI and Anthropic environment variables
- **Clipboard** — Copies `export` or `$env:` commands for your terminal

The config generator uses **smart merge** — it only updates GateX-related keys, preserving all your other settings. Model picker shows grouped results with ⭐ recommendations per IDE.

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | OpenAI format chat |
| `/v1/messages` | POST | Anthropic format chat |
| `/v1/health` | GET | Server health status |

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gatex.port` | `24680` | Server port (0 = auto select) |
| `gatex.timeout` | `300` | Request timeout in seconds |
| `gatex.maxRetries` | `3` | Max retry attempts |
| `gatex.vendors` | `["copilot"]` | Model vendors to expose (`copilot`, `aitk-github`, `aitk-foundry`, `*`) |

## 🎯 Commands

| Command | Description |
|---------|-------------|
| `GateX: Configure for IDE` | Generate config for Claude Code, .env, etc. |
| `GateX: Show Connection Info` | Display endpoint, models, and quick actions |
| `GateX: Copy Endpoint URL` | Copy endpoint to clipboard |
| `GateX: Check Model Health` | Test all models |
| `GateX: Restart Server` | Restart the HTTP server |

## 🔧 Troubleshooting

### No models available?
Make sure you have GitHub Copilot or another LLM extension installed and signed in.

### Port already in use?
Set `gatex.port` to `0` for auto-selection, or choose a different port.

### Request timeout?
Increase `gatex.timeout` in settings for long-running requests.

### Model not found?
GateX uses fuzzy matching — try shorter names like `claude-sonnet-4` or `gpt-4o`. Run `GateX: Show Connection Info` to see available models.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Your App / IDE / CLI                            │
│  (OpenAI SDK / Anthropic SDK / curl)             │
└─────────────┬───────────────────────────────────┘
              │ HTTP (localhost:24680)
┌─────────────▼───────────────────────────────────┐
│  GateX Extension                                 │
│  ┌─────────────────────────────────────────┐     │
│  │  server.ts — HTTP Router                │     │
│  │  • /v1/chat/completions (OpenAI)        │     │
│  │  • /v1/messages (Anthropic)             │     │
│  │  • Retry with exponential backoff       │     │
│  └──────────────┬──────────────────────────┘     │
│  ┌──────────────▼──────────────────────────┐     │
│  │  models.ts — Model Manager              │     │
│  │  • Exact + fuzzy matching               │     │
│  │  • 30s model cache                      │     │
│  └──────────────┬──────────────────────────┘     │
│  ┌──────────────▼──────────────────────────┐     │
│  │  configGenerator.ts — IDE Setup         │     │
│  │  • Claude Code (dual model + onboarding)│     │
│  │  • Codex CLI (TOML config)              │     │
│  │  • .env, clipboard                      │     │
│  │  • Smart merge (preserve existing)      │     │
│  └─────────────────────────────────────────┘     │
└─────────────┬───────────────────────────────────┘
              │ vscode.lm API (zero auth)
┌─────────────▼───────────────────────────────────┐
│  VS Code Language Model Providers                │
│  (GitHub Copilot, etc.)                          │
└─────────────────────────────────────────────────┘
```

## 📦 Source Files

| File | Lines | Description |
|------|-------|-------------|
| `server.ts` | ~490 | HTTP server, OpenAI + Anthropic handlers, retry |
| `configGenerator.ts` | ~460 | IDE config generation (Claude Code, Codex, .env) |
| `models.ts` | ~195 | VS Code LM model management + vendor filter |
| `extension.ts` | ~160 | Entry point, command registration |
| `statusBar.ts` | ~80 | Status bar display |

**Total: ~1,385 lines** — lean and focused.

## 📄 License

MIT

## 🙏 Acknowledgments

Built with ❤️ using the VS Code Language Model API.
