# ⚡ GateX

**Your gateway to AI models** - Access VS Code LLM providers via a simple HTTP API.

Turn your GitHub Copilot subscription into a local AI API server. Use Claude, GPT-4o, Gemini, and more with any OpenAI or Anthropic SDK.

![GateX Dashboard](https://raw.githubusercontent.com/Polly2014/GateX/main/images/dashboard.png)

## ✨ Features

- 🚀 **Zero Configuration** - Starts automatically, finds an available port
- 🔌 **Dual API Format** - OpenAI + Anthropic compatible endpoints
- 🌊 **SSE Streaming** - Real-time streaming responses
- 🔄 **Smart Retry** - Exponential backoff for transient failures
- 💾 **Response Cache** - LRU cache for repeated requests
- 📊 **Cyberpunk Dashboard** - Real-time monitoring with Matrix aesthetics
- 🏥 **Health Monitoring** - Check model availability and latency
- 🎯 **Multi-Model Support** - Access Claude, GPT-4o, Gemini, and more

## 🚀 Quick Start

### 1. Install & Activate

The extension starts automatically when VS Code opens. Look for the status bar item:

```
⚡ GateX: 5 models
```

### 2. Open Dashboard

- Click the status bar item, or
- Press `Cmd+Shift+P` → `GateX: Open Dashboard`

### 3. Use in Your Code

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
    stream=True  # Streaming supported!
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

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | OpenAI format chat |
| `/v1/messages` | POST | Anthropic format chat |
| `/v1/health` | GET | Server health status |
| `/v1/stats` | GET | Usage statistics |
| `/v1/cache/stats` | GET | Cache statistics |

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gatex.port` | `24680` | Server port (0 = auto select) |
| `gatex.timeout` | `300` | Request timeout in seconds |
| `gatex.maxRetries` | `3` | Max retry attempts |
| `gatex.cacheEnabled` | `true` | Enable response caching |
| `gatex.cacheMaxAge` | `300` | Cache TTL in seconds |
| `gatex.maxConcurrent` | `5` | Max concurrent requests |

## 🎯 Commands

| Command | Description |
|---------|-------------|
| `GateX: Open Dashboard` | Open Cyberpunk monitoring panel |
| `GateX: Show Connection Info` | Display endpoint and models |
| `GateX: Copy Endpoint URL` | Copy endpoint to clipboard |
| `GateX: Copy Python Code Snippet` | Copy ready-to-use code |
| `GateX: Check Model Health` | Test all models |
| `GateX: Restart Server` | Restart the HTTP server |

## 🖥️ Dashboard

GateX includes a Cyberpunk-styled monitoring dashboard:

- **Real-time Stats** - Requests, success rate, tokens, RPM
- **Model Health** - Ping all models with one click
- **Cache Status** - Hit rate and memory usage
- **Config Export** - Copy Python/cURL/Node.js snippets

## 🔧 Troubleshooting

### No models available?
Make sure you have GitHub Copilot or another LLM extension installed and signed in.

### Port already in use?
Set `gatex.port` to `0` for auto-selection, or choose a different port.

### Request timeout?
Increase `gatex.timeout` in settings for long-running requests.

### Cache not working?
Check if `gatex.cacheEnabled` is `true`. Only deterministic requests (temperature=0) are cached.

## 📄 License

MIT

## 🙏 Acknowledgments

Built with ❤️ using the VS Code Language Model API.
