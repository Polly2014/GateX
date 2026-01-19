/**
 * GateX Dashboard - Cyberpunk Terminal Edition
 * 
 * A distinctive, memorable dashboard with Matrix/terminal aesthetics
 */

import * as vscode from 'vscode';
import { ModelManager, ModelInfo } from './models';
import { statsManager, ModelStats } from './stats';
import { requestQueue } from './queue';
import { responseCache } from './cache';

interface ModelDisplay {
    info: ModelInfo;
    stats?: ModelStats;
    checking: boolean;
}

export class Dashboard {
    private panel: vscode.WebviewPanel | undefined;
    private modelManager: ModelManager;
    private port: number;
    private refreshInterval: NodeJS.Timeout | undefined;
    private latencyInterval: NodeJS.Timeout | undefined;
    private modelDisplays: Map<string, ModelDisplay> = new Map();
    private unsubscribe: (() => void) | undefined;

    constructor(modelManager: ModelManager, port: number) {
        this.modelManager = modelManager;
        this.port = port;
    }

    async show() {
        if (this.panel) {
            this.panel.reveal();
            await this.refresh();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'gatexDashboard',
            '⚡ GateX Terminal',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this.panel.onDidDispose(() => {
            this.stopAutoRefresh();
            this.stopLatencyRefresh();
            if (this.unsubscribe) {
                this.unsubscribe();
            }
            this.panel = undefined;
        });

        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'copy':
                    await vscode.env.clipboard.writeText(message.text);
                    vscode.window.showInformationMessage('📋 Copied to clipboard');
                    break;
                case 'checkAllHealth':
                    await this.checkAllHealth();
                    break;
                case 'checkModel':
                    await this.checkModelHealth(message.modelId);
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'showGlobalConfig':
                    this.showGlobalConfigModal();
                    break;
                case 'showModelConfig':
                    this.showModelConfigModal(message.modelId);
                    break;
                case 'closeModal':
                    // Modal closed client-side
                    break;
            }
        });

        this.unsubscribe = statsManager.onChange(() => {
            this.sendStatsUpdate();
        });

        this.startAutoRefresh(3000);
        this.startLatencyRefresh(30000);
        await this.refresh();
        // Initial latency check after short delay
        setTimeout(() => this.checkAllHealth(), 500);
    }

    private startLatencyRefresh(interval: number) {
        this.stopLatencyRefresh();
        this.latencyInterval = setInterval(() => {
            this.checkAllHealth();
        }, interval);
    }

    private stopLatencyRefresh() {
        if (this.latencyInterval) {
            clearInterval(this.latencyInterval);
            this.latencyInterval = undefined;
        }
    }

    private showGlobalConfigModal() {
        if (!this.panel) return;
        
        const endpoint = `http://localhost:${this.port}/v1`;
        
        this.panel.webview.postMessage({
            command: 'showModal',
            title: 'Global Configuration',
            configs: [
                {
                    name: 'OpenAI Python SDK',
                    language: 'python',
                    code: `from openai import OpenAI

client = OpenAI(
    base_url="${endpoint}",
    api_key="gatex"  # Any non-empty string works
)

response = client.chat.completions.create(
    model="gpt-4o",  # Any available model
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True  # Streaming supported
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")`
                },
                {
                    name: 'Anthropic Python SDK',
                    language: 'python',
                    code: `import anthropic

client = anthropic.Anthropic(
    base_url="${endpoint}",
    api_key="gatex"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",  # Maps to gpt-4o
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)

print(message.content[0].text)`
                },
                {
                    name: 'cURL (OpenAI format)',
                    language: 'bash',
                    code: `curl ${endpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer gatex" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`
                },
                {
                    name: 'cURL (Anthropic format)',
                    language: 'bash',
                    code: `curl ${endpoint}/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: gatex" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`
                },
                {
                    name: 'Environment Variables',
                    language: 'bash',
                    code: `# For OpenAI-compatible clients
export OPENAI_API_BASE="${endpoint}"
export OPENAI_API_KEY="gatex"

# For Anthropic-compatible clients  
export ANTHROPIC_BASE_URL="${endpoint}"
export ANTHROPIC_API_KEY="gatex"

# For generic HTTP clients
export GATEX_ENDPOINT="${endpoint}"
export GATEX_API_KEY="gatex"`
                },
                {
                    name: 'Codex CLI Config',
                    language: 'json',
                    code: `{
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "gatex",
  "providers": {
    "openai": {
      "name": "GateX Local Gateway",
      "baseURL": "${endpoint}",
      "envKey": "GATEX_API_KEY"
    }
  }
}`
                },
                {
                    name: 'Claude Code Config',
                    language: 'json',
                    code: `{
  "apiProvider": "anthropic",
  "anthropicBaseUrl": "${endpoint}",
  "anthropicApiKey": "gatex",
  "model": "claude-sonnet-4-20250514"
}`
                }
            ]
        });
    }

    private async showModelConfigModal(modelId: string) {
        if (!this.panel) return;
        
        const model = await this.modelManager.getModel(modelId);
        if (!model) return;

        const endpoint = `http://localhost:${this.port}/v1`;
        const modelStats = statsManager.getModelStats(modelId);
        
        this.panel.webview.postMessage({
            command: 'showModal',
            title: `Model: ${modelId}`,
            configs: [
                {
                    name: 'Model Info',
                    language: 'yaml',
                    code: `id: ${modelId}
name: ${model.name}
vendor: ${model.vendor}
family: ${model.family}
context_window: ${model.maxInputTokens || 'N/A'}
status: ${modelStats?.status || 'unknown'}
last_latency: ${modelStats?.lastLatency ? modelStats.lastLatency + 'ms' : 'N/A'}
total_requests: ${modelStats?.totalRequests || 0}
total_tokens: ${(modelStats?.totalInputTokens || 0) + (modelStats?.totalOutputTokens || 0)}`
                },
                {
                    name: 'Python (OpenAI)',
                    language: 'python',
                    code: `from openai import OpenAI

client = OpenAI(
    base_url="${endpoint}",
    api_key="gatex"
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    temperature=0.7,
    max_tokens=1024,
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`
                },
                {
                    name: 'cURL',
                    language: 'bash',
                    code: `curl ${endpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer gatex" \\
  -d '{
    "model": "${modelId}",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "temperature": 0.7,
    "max_tokens": 1024,
    "stream": true
  }'`
                },
                {
                    name: 'Node.js',
                    language: 'javascript',
                    code: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${endpoint}',
  apiKey: 'gatex'
});

async function main() {
  const stream = await client.chat.completions.create({
    model: '${modelId}',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main();`
                }
            ]
        });
    }

    private startAutoRefresh(interval: number) {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => {
            this.sendStatsUpdate();
        }, interval);
    }

    private stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
    }

    private sendStatsUpdate() {
        if (!this.panel) return;
        
        const stats = statsManager.getStats();
        const queueStats = requestQueue.getStats();
        const cacheStats = responseCache.getStats();
        
        this.panel.webview.postMessage({
            command: 'statsUpdate',
            stats: {
                uptime: stats.uptime,
                totalRequests: stats.global.totalRequests,
                activeConnections: stats.global.activeConnections,
                totalInputTokens: stats.global.totalInputTokens,
                totalOutputTokens: stats.global.totalOutputTokens,
                avgLatency: Math.round(stats.avgLatency),
                successRate: stats.successRate,
                rpm: stats.rpm,
                tpm: stats.tpm,
                queuePending: queueStats.pending,
                queueRetried: queueStats.retried,
                cacheHitRate: cacheStats.hitRate,
                cacheEntries: cacheStats.entries
            }
        });
    }

    async refresh() {
        if (!this.panel) return;

        const models = await this.modelManager.getModels();
        
        for (const model of models) {
            if (!this.modelDisplays.has(model.id)) {
                this.modelDisplays.set(model.id, {
                    info: model,
                    stats: statsManager.getModelStats(model.id),
                    checking: false
                });
            } else {
                const display = this.modelDisplays.get(model.id)!;
                display.info = model;
                display.stats = statsManager.getModelStats(model.id);
            }
        }

        const stats = statsManager.getStats();
        this.panel.webview.html = this.getHtml(models, stats);
    }

    async checkAllHealth() {
        if (!this.panel) return;

        const models = await this.modelManager.getModels();
        
        for (const model of models) {
            this.panel.webview.postMessage({
                command: 'modelStatus',
                modelId: model.id,
                status: 'checking'
            });
        }

        await this.modelManager.healthCheck((model, status, latency) => {
            statsManager.updateModelStatus(
                model.id, 
                status === 'healthy' ? 'healthy' : 'error',
                latency
            );

            if (this.panel) {
                this.panel.webview.postMessage({
                    command: 'modelStatus',
                    modelId: model.id,
                    status: status === 'healthy' ? 'healthy' : 'error',
                    latency: latency
                });
            }
        });
    }

    async checkModelHealth(modelId: string) {
        const model = await this.modelManager.getModel(modelId);
        if (!model || !this.panel) return;

        this.panel.webview.postMessage({
            command: 'modelStatus',
            modelId: modelId,
            status: 'checking'
        });

        try {
            const startTime = Date.now();
            const messages = [
                vscode.LanguageModelChatMessage.User('Say "OK" only.')
            ];
            
            const cts = new vscode.CancellationTokenSource();
            const timeoutId = setTimeout(() => cts.cancel(), 30000);
            
            const response = await model.sendRequest(messages, {}, cts.token);
            let text = '';
            for await (const chunk of response.text) {
                text += chunk;
                if (text.length > 50) break;
            }
            
            clearTimeout(timeoutId);
            const latency = Date.now() - startTime;

            statsManager.updateModelStatus(modelId, 'healthy', latency);

            this.panel.webview.postMessage({
                command: 'modelStatus',
                modelId: modelId,
                status: 'healthy',
                latency
            });
        } catch (error: any) {
            statsManager.updateModelStatus(modelId, 'error');
            
            this.panel.webview.postMessage({
                command: 'modelStatus',
                modelId: modelId,
                status: 'error',
                error: error.message || String(error)
            });
        }
    }

    private getHtml(models: ModelInfo[], stats: ReturnType<typeof statsManager.getStats>): string {
        const endpoint = `http://localhost:${this.port}/v1`;
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
        const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        
        const modelRows = models.map((m, i) => {
            const modelStats = stats.models.get(m.id);
            const status = modelStats?.status || 'unknown';
            const latency = modelStats?.lastLatency;
            const requests = modelStats?.totalRequests || 0;
            const tokens = (modelStats?.totalInputTokens || 0) + (modelStats?.totalOutputTokens || 0);
            
            const statusChar = status === 'healthy' ? '●' : status === 'error' ? '✕' : status === 'checking' ? '◌' : '○';
            const statusColor = status === 'healthy' ? 'var(--neon)' : status === 'error' ? 'var(--red)' : status === 'checking' ? 'var(--yellow)' : 'var(--dim)';
            
            return `
                <tr class="model-row ${status}" data-model-id="${m.id}" style="animation-delay: ${i * 50}ms">
                    <td class="status-col">
                        <span class="status-char" style="color: ${statusColor}">${statusChar}</span>
                    </td>
                    <td class="id-col">
                        <span class="model-id">${m.id}</span>
                    </td>
                    <td class="vendor-col">${m.vendor}</td>
                    <td class="ctx-col">${this.formatNumber(m.maxInputTokens || 0)}</td>
                    <td class="latency-col latency-value">${latency ? latency + 'ms' : '---'}</td>
                    <td class="reqs-col">${requests}</td>
                    <td class="tokens-col">${this.formatNumber(tokens)}</td>
                    <td class="actions-col">
                        <button class="cmd-btn" onclick="checkModel('${m.id}')" title="ping">▶</button>
                        <button class="cmd-btn" onclick="showModelConfig('${m.id}')" title="export">⎙</button>
                    </td>
                </tr>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GateX Terminal</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0a0a;
            --bg-alt: #111111;
            --bg-panel: #0d0d0d;
            --border: #1a1a1a;
            --border-bright: #2a2a2a;
            --neon: #00ff9f;
            --neon-dim: #00cc7f;
            --cyan: #00d4ff;
            --yellow: #ffcc00;
            --red: #ff3366;
            --text: #e0e0e0;
            --dim: #555555;
            --muted: #333333;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            font-size: 13px;
            line-height: 1.6;
            position: relative;
            overflow-x: hidden;
        }

        /* CRT Scanlines Effect */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: repeating-linear-gradient(
                0deg,
                rgba(0, 0, 0, 0.1) 0px,
                rgba(0, 0, 0, 0.1) 1px,
                transparent 1px,
                transparent 2px
            );
            pointer-events: none;
            z-index: 1000;
        }

        /* Subtle CRT glow */
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.3) 100%);
            pointer-events: none;
            z-index: 999;
        }

        /* ASCII Header */
        .ascii-header {
            background: var(--bg-panel);
            border-bottom: 1px solid var(--border);
            padding: 16px 24px;
            position: relative;
        }

        .ascii-art {
            color: var(--neon);
            font-family: 'Share Tech Mono', monospace;
            font-size: 10px;
            line-height: 1.2;
            text-shadow: 0 0 10px var(--neon), 0 0 20px var(--neon);
            white-space: pre;
            letter-spacing: 1px;
        }

        .header-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px dashed var(--border);
        }

        .system-info {
            color: var(--dim);
            font-size: 11px;
        }

        .system-info span {
            color: var(--cyan);
        }

        .live-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--neon);
            font-size: 11px;
        }

        .live-dot {
            width: 8px;
            height: 8px;
            background: var(--neon);
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
            box-shadow: 0 0 8px var(--neon);
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
        }

        /* Main Container */
        .container {
            max-width: 1600px;
            margin: 0 auto;
            padding: 24px;
        }

        /* Stats Panel - Terminal Style */
        .stats-panel {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            margin-bottom: 24px;
            position: relative;
        }

        .panel-header {
            background: var(--bg-alt);
            padding: 8px 16px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .panel-title {
            color: var(--cyan);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .panel-controls {
            display: flex;
            gap: 8px;
        }

        .panel-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--muted);
        }

        .panel-dot.red { background: var(--red); }
        .panel-dot.yellow { background: var(--yellow); }
        .panel-dot.green { background: var(--neon); }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 1px;
            background: var(--border);
        }

        .stat-cell {
            background: var(--bg-panel);
            padding: 20px;
            text-align: center;
            position: relative;
        }

        .stat-cell::before {
            content: '';
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 40%;
            height: 2px;
            background: linear-gradient(90deg, transparent, var(--neon), transparent);
            opacity: 0.3;
        }

        .stat-label {
            color: var(--dim);
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 28px;
            font-weight: 700;
            color: var(--neon);
            text-shadow: 0 0 10px rgba(0, 255, 159, 0.3);
            font-variant-numeric: tabular-nums;
        }

        .stat-value.alt { color: var(--cyan); text-shadow: 0 0 10px rgba(0, 212, 255, 0.3); }
        .stat-value.warn { color: var(--yellow); text-shadow: 0 0 10px rgba(255, 204, 0, 0.3); }

        /* Connection Box */
        .connection-box {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            margin-bottom: 24px;
            font-size: 12px;
        }

        .connection-box .panel-header {
            background: linear-gradient(90deg, var(--bg-alt), transparent);
        }

        .connection-content {
            padding: 16px;
            display: grid;
            grid-template-columns: 1fr 1fr auto;
            gap: 24px;
            align-items: center;
        }

        .conn-item {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .conn-label {
            color: var(--dim);
            min-width: 80px;
        }

        .conn-value {
            color: var(--cyan);
            background: var(--bg);
            padding: 6px 12px;
            border: 1px solid var(--border);
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s;
        }

        .conn-value:hover {
            border-color: var(--neon);
            box-shadow: 0 0 10px rgba(0, 255, 159, 0.2);
        }

        .quick-copy-btn {
            background: transparent;
            border: 1px solid var(--neon);
            color: var(--neon);
            padding: 8px 20px;
            font-family: inherit;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .quick-copy-btn:hover {
            background: var(--neon);
            color: var(--bg);
            box-shadow: 0 0 20px rgba(0, 255, 159, 0.4);
        }

        /* Models Table */
        .models-panel {
            background: var(--bg-panel);
            border: 1px solid var(--border);
        }

        .models-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: var(--bg-alt);
            border-bottom: 1px solid var(--border);
        }

        .models-title {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .models-title h2 {
            color: var(--cyan);
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .model-count {
            color: var(--neon);
            font-size: 12px;
        }

        .models-actions {
            display: flex;
            gap: 8px;
        }

        .action-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text);
            padding: 6px 12px;
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .action-btn:hover {
            border-color: var(--cyan);
            color: var(--cyan);
        }

        .action-btn.primary {
            border-color: var(--neon);
            color: var(--neon);
        }

        .action-btn.primary:hover {
            background: var(--neon);
            color: var(--bg);
        }

        /* Table */
        .models-table {
            width: 100%;
            border-collapse: collapse;
        }

        .models-table th {
            background: var(--bg);
            padding: 10px 12px;
            text-align: left;
            font-size: 10px;
            font-weight: 500;
            color: var(--dim);
            text-transform: uppercase;
            letter-spacing: 1px;
            border-bottom: 1px solid var(--border);
        }

        .models-table td {
            padding: 12px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
        }

        .model-row {
            transition: all 0.2s;
            animation: fadeIn 0.3s ease-out both;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateX(-10px); }
            to { opacity: 1; transform: translateX(0); }
        }

        .model-row:hover {
            background: var(--bg-alt);
        }

        .model-row.healthy .status-char { animation: glow 2s ease-in-out infinite; }

        @keyframes glow {
            0%, 100% { text-shadow: 0 0 5px currentColor; }
            50% { text-shadow: 0 0 15px currentColor, 0 0 25px currentColor; }
        }

        .status-char {
            font-size: 14px;
            font-weight: bold;
        }

        .model-id {
            color: var(--text);
            font-weight: 500;
        }

        .vendor-col { color: var(--dim); }
        .ctx-col { color: var(--cyan); font-variant-numeric: tabular-nums; }
        .latency-col { color: var(--yellow); font-variant-numeric: tabular-nums; }
        .reqs-col { color: var(--neon); font-variant-numeric: tabular-nums; }
        .tokens-col { color: var(--dim); font-variant-numeric: tabular-nums; }

        .cmd-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--dim);
            width: 28px;
            height: 28px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            margin-right: 4px;
        }

        .cmd-btn:hover {
            border-color: var(--neon);
            color: var(--neon);
            box-shadow: 0 0 8px rgba(0, 255, 159, 0.3);
        }

        /* Footer */
        .footer {
            margin-top: 24px;
            padding: 16px;
            border-top: 1px dashed var(--border);
            display: flex;
            justify-content: space-between;
            color: var(--dim);
            font-size: 10px;
        }

        .footer-left {
            display: flex;
            gap: 24px;
        }

        .footer span { color: var(--neon); }

        /* Terminal Cursor */
        .cursor {
            display: inline-block;
            width: 8px;
            height: 14px;
            background: var(--neon);
            animation: blink 1s step-end infinite;
            vertical-align: middle;
            margin-left: 4px;
        }

        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }

        /* Checking animation */
        .model-row.checking .status-char {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        /* Responsive */
        @media (max-width: 1200px) {
            .stats-grid {
                grid-template-columns: repeat(4, 1fr);
            }
        }

        @media (max-width: 800px) {
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }
            .connection-content {
                grid-template-columns: 1fr;
            }
        }

        /* Modal Overlay */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(4px);
            z-index: 2000;
            display: none;
            justify-content: center;
            align-items: center;
            animation: fadeIn 0.2s ease-out;
        }

        .modal-overlay.active {
            display: flex;
        }

        .modal {
            background: var(--bg-panel);
            border: 1px solid var(--neon);
            box-shadow: 0 0 40px rgba(0, 255, 159, 0.2), inset 0 0 60px rgba(0, 255, 159, 0.02);
            max-width: 800px;
            width: 90%;
            max-height: 85vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }

        .modal-header {
            background: var(--bg-alt);
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .modal-title {
            color: var(--neon);
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .modal-close {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--dim);
            width: 32px;
            height: 32px;
            font-size: 18px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .modal-close:hover {
            border-color: var(--red);
            color: var(--red);
        }

        .modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        }

        .config-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px dashed var(--border);
        }

        .config-tab {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--dim);
            padding: 8px 16px;
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .config-tab:hover {
            border-color: var(--cyan);
            color: var(--cyan);
        }

        .config-tab.active {
            border-color: var(--neon);
            color: var(--neon);
            background: rgba(0, 255, 159, 0.1);
        }

        .config-content {
            display: none;
        }

        .config-content.active {
            display: block;
        }

        .config-code {
            background: var(--bg);
            border: 1px solid var(--border);
            padding: 16px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            line-height: 1.6;
            color: var(--text);
            overflow-x: auto;
            white-space: pre;
            position: relative;
        }

        .config-code .keyword { color: var(--cyan); }
        .config-code .string { color: var(--neon); }
        .config-code .comment { color: var(--dim); }

        .copy-code-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: var(--bg-alt);
            border: 1px solid var(--border);
            color: var(--dim);
            padding: 6px 12px;
            font-family: inherit;
            font-size: 10px;
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
        }

        .copy-code-btn:hover {
            border-color: var(--neon);
            color: var(--neon);
        }

        .copy-code-btn.copied {
            border-color: var(--neon);
            color: var(--neon);
            background: rgba(0, 255, 159, 0.1);
        }

        .modal-footer {
            padding: 16px 20px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }

        .modal-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text);
            padding: 10px 24px;
            font-family: inherit;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .modal-btn:hover {
            border-color: var(--cyan);
            color: var(--cyan);
        }

        .modal-btn.primary {
            border-color: var(--neon);
            color: var(--neon);
        }

        .modal-btn.primary:hover {
            background: var(--neon);
            color: var(--bg);
        }

        /* Latency auto-refresh indicator */
        .latency-refresh-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--dim);
            font-size: 10px;
        }

        .latency-refresh-indicator .dot {
            width: 6px;
            height: 6px;
            background: var(--cyan);
            border-radius: 50%;
            animation: pulse 30s linear infinite;
        }
    </style>
</head>
<body>
    <!-- ASCII Header -->
    <header class="ascii-header">
        <pre class="ascii-art">
 ██████╗  █████╗ ████████╗███████╗██╗  ██╗
██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝
██║  ███╗███████║   ██║   █████╗   ╚███╔╝ 
██║   ██║██╔══██║   ██║   ██╔══╝   ██╔██╗ 
╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗
 ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝</pre>
        <div class="header-meta">
            <div class="system-info">
                <span>SYSTEM</span> GateX v0.4.0 | <span>PORT</span> :${this.port} | <span>TIME</span> ${timeStr} | <span>DATE</span> ${dateStr}
            </div>
            <div class="live-indicator">
                <span class="live-dot"></span>
                LIVE
            </div>
        </div>
    </header>

    <div class="container">
        <!-- Stats Panel -->
        <div class="stats-panel">
            <div class="panel-header">
                <span class="panel-title">// System Metrics</span>
                <div class="panel-controls">
                    <span class="panel-dot red"></span>
                    <span class="panel-dot yellow"></span>
                    <span class="panel-dot green"></span>
                </div>
            </div>
            <div class="stats-grid">
                <div class="stat-cell">
                    <div class="stat-label">Uptime</div>
                    <div class="stat-value" id="uptime">${this.formatUptime(stats.uptime)}</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-label">Requests</div>
                    <div class="stat-value" id="totalRequests">${stats.global.totalRequests}</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-label">Active</div>
                    <div class="stat-value alt" id="activeConnections">${stats.global.activeConnections}</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-label">Avg Latency</div>
                    <div class="stat-value warn" id="avgLatency">${Math.round(stats.avgLatency)}<small>ms</small></div>
                </div>
                <div class="stat-cell">
                    <div class="stat-label">Success</div>
                    <div class="stat-value" id="successRate">${stats.successRate.toFixed(0)}%</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-label">RPM</div>
                    <div class="stat-value alt" id="rpm">${stats.rpm}</div>
                </div>
                <div class="stat-cell">
                    <div class="stat-label">Tokens</div>
                    <div class="stat-value" id="totalTokens">${this.formatNumber(stats.global.totalInputTokens + stats.global.totalOutputTokens)}</div>
                </div>
            </div>
        </div>

        <!-- Connection Box -->
        <div class="connection-box">
            <div class="panel-header">
                <span class="panel-title">// Connection</span>
            </div>
            <div class="connection-content">
                <div class="conn-item">
                    <span class="conn-label">endpoint$</span>
                    <code class="conn-value" onclick="copy('${endpoint}')">${endpoint}</code>
                </div>
                <div class="conn-item">
                    <span class="conn-label">api_key$</span>
                    <code class="conn-value" onclick="copy('gatex')">gatex</code>
                </div>
                <button class="quick-copy-btn" onclick="showGlobalConfig()">
                    [ EXPORT CONFIG ]
                </button>
            </div>
        </div>

        <!-- Models Panel -->
        <div class="models-panel">
            <div class="models-header">
                <div class="models-title">
                    <h2>// Models<span class="cursor"></span></h2>
                    <span class="model-count">[${models.length}]</span>
                </div>
                <div class="models-actions">
                    <button class="action-btn" onclick="refresh()">REFRESH</button>
                    <button class="action-btn primary" onclick="checkAllHealth()">PING ALL</button>
                </div>
            </div>
            <table class="models-table">
                <thead>
                    <tr>
                        <th style="width:40px">STS</th>
                        <th>MODEL_ID</th>
                        <th>VENDOR</th>
                        <th>CTX</th>
                        <th>LATENCY</th>
                        <th>REQS</th>
                        <th>TOKENS</th>
                        <th style="width:80px">CMD</th>
                    </tr>
                </thead>
                <tbody>
                    ${modelRows}
                </tbody>
            </table>
        </div>

        <!-- Footer -->
        <footer class="footer">
            <div class="footer-left">
                <span>GateX</span> :: AI Gateway for VS Code
                <span>|</span> Built to replace Agent Maestro
            </div>
            <div>
                <span class="latency-refresh-indicator">
                    <span class="dot"></span>
                    Latency: <span>30s</span>
                </span>
                <span style="margin: 0 8px;">|</span>
                Auto-refresh: <span>3s</span> | Press <span>F5</span> to force refresh
            </div>
        </footer>
    </div>

    <!-- Modal Container -->
    <div class="modal-overlay" id="modalOverlay">
        <div class="modal">
            <div class="modal-header">
                <span class="modal-title" id="modalTitle">Configuration</span>
                <button class="modal-close" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="config-tabs" id="configTabs"></div>
                <div id="configContents"></div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn" onclick="closeModal()">Close</button>
                <button class="modal-btn primary" onclick="copyCurrentConfig()">Copy Current</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const endpoint = '${endpoint}';
        let currentConfigs = [];
        let activeConfigIndex = 0;

        function copy(text) {
            vscode.postMessage({ command: 'copy', text: text });
        }

        function showGlobalConfig() {
            vscode.postMessage({ command: 'showGlobalConfig' });
        }

        function showModelConfig(modelId) {
            vscode.postMessage({ command: 'showModelConfig', modelId: modelId });
        }

        function checkAllHealth() {
            vscode.postMessage({ command: 'checkAllHealth' });
        }

        function checkModel(modelId) {
            vscode.postMessage({ command: 'checkModel', modelId: modelId });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function closeModal() {
            document.getElementById('modalOverlay').classList.remove('active');
        }

        function openModal(title, configs) {
            currentConfigs = configs;
            activeConfigIndex = 0;
            
            document.getElementById('modalTitle').textContent = title;
            
            const tabsContainer = document.getElementById('configTabs');
            const contentsContainer = document.getElementById('configContents');
            
            tabsContainer.innerHTML = configs.map((cfg, i) => 
                \`<button class="config-tab \${i === 0 ? 'active' : ''}" onclick="switchTab(\${i})">\${cfg.name}</button>\`
            ).join('');
            
            contentsContainer.innerHTML = configs.map((cfg, i) => \`
                <div class="config-content \${i === 0 ? 'active' : ''}" id="config-\${i}">
                    <div class="config-code">
                        <button class="copy-code-btn" onclick="copyConfig(\${i})">Copy</button>
                        <pre>\${escapeHtml(cfg.code)}</pre>
                    </div>
                </div>
            \`).join('');
            
            document.getElementById('modalOverlay').classList.add('active');
        }

        function switchTab(index) {
            activeConfigIndex = index;
            
            document.querySelectorAll('.config-tab').forEach((tab, i) => {
                tab.classList.toggle('active', i === index);
            });
            
            document.querySelectorAll('.config-content').forEach((content, i) => {
                content.classList.toggle('active', i === index);
            });
        }

        function copyConfig(index) {
            const config = currentConfigs[index];
            if (config) {
                copy(config.code);
                const btn = document.querySelectorAll('.copy-code-btn')[index];
                if (btn) {
                    btn.textContent = 'Copied!';
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.textContent = 'Copy';
                        btn.classList.remove('copied');
                    }, 2000);
                }
            }
        }

        function copyCurrentConfig() {
            copyConfig(activeConfigIndex);
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Handle stats updates
        window.addEventListener('message', event => {
            const msg = event.data;
            
            if (msg.command === 'statsUpdate') {
                document.getElementById('totalRequests').textContent = msg.stats.totalRequests;
                document.getElementById('activeConnections').textContent = msg.stats.activeConnections;
                document.getElementById('avgLatency').innerHTML = msg.stats.avgLatency + '<small>ms</small>';
                document.getElementById('successRate').textContent = msg.stats.successRate.toFixed(0) + '%';
                document.getElementById('rpm').textContent = msg.stats.rpm;
                document.getElementById('totalTokens').textContent = formatNumber(msg.stats.totalInputTokens + msg.stats.totalOutputTokens);
                document.getElementById('uptime').textContent = formatUptime(msg.stats.uptime);
            }
            
            if (msg.command === 'modelStatus') {
                const row = document.querySelector(\`[data-model-id="\${msg.modelId}"]\`);
                if (row) {
                    row.className = 'model-row ' + msg.status;
                    const statusChar = row.querySelector('.status-char');
                    
                    if (msg.status === 'healthy') {
                        statusChar.textContent = '●';
                        statusChar.style.color = 'var(--neon)';
                    } else if (msg.status === 'error') {
                        statusChar.textContent = '✕';
                        statusChar.style.color = 'var(--red)';
                    } else if (msg.status === 'checking') {
                        statusChar.textContent = '◌';
                        statusChar.style.color = 'var(--yellow)';
                    }
                    
                    if (msg.latency) {
                        const latencyEl = row.querySelector('.latency-value');
                        if (latencyEl) latencyEl.textContent = msg.latency + 'ms';
                    }
                }
            }

            if (msg.command === 'showModal') {
                openModal(msg.title, msg.configs);
            }
        });

        function formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        function formatUptime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) return days + 'd ' + (hours % 24) + 'h';
            if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
            if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
            return seconds + 's';
        }

        // F5 to refresh
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F5') {
                e.preventDefault();
                refresh();
            }
        });
    </script>
</body>
</html>`;
    }

    private formatNumber(num: number): string {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
        return num.toString();
    }

    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    dispose() {
        this.stopAutoRefresh();
        this.stopLatencyRefresh();
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.panel) {
            this.panel.dispose();
        }
    }
}
