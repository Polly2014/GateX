/**
 * GateX HTTP Server - Full Featured Edition
 * 
 * Features:
 * - OpenAI API compatible (/v1/chat/completions)
 * - Anthropic API compatible (/v1/messages)
 * - SSE Streaming support
 * - Smart retry with exponential backoff
 * - Response caching
 * - Request queuing
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { ModelManager } from './models';
import { statsManager, StatsManager } from './stats';
import { requestQueue } from './queue';
import { responseCache } from './cache';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenAIChatRequest {
    model: string;
    messages: ChatMessage[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
}

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | { type: 'text'; text: string }[];
}

interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    system?: string;
    max_tokens: number;
    stream?: boolean;
}

export class GateXServer {
    private server: http.Server | null = null;
    private port: number = 0;
    private modelManager: ModelManager;

    constructor(modelManager: ModelManager) {
        this.modelManager = modelManager;
    }

    async start(): Promise<number> {
        const config = vscode.workspace.getConfiguration('gatex');
        const configuredPort = config.get<number>('port') || 0;
        
        this.port = configuredPort || await this.findAvailablePort();

        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on('error', (err) => {
                reject(err);
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                console.log(`⚡ GateX server listening on port ${this.port}`);
                resolve(this.port);
            });
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            console.log('🛑 GateX server stopped');
        }
    }

    getPort(): number {
        return this.port;
    }

    private async findAvailablePort(): Promise<number> {
        const preferred = [24680, 24681, 24682, 24683, 24684];
        
        for (const port of preferred) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        return 0;
    }

    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = http.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port, '127.0.0.1');
        });
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, anthropic-version');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '/';

        try {
            // OpenAI endpoints
            if (url === '/v1/models' || url === '/models') {
                await this.handleModels(req, res);
            } else if (url === '/v1/chat/completions' || url === '/chat/completions') {
                await this.handleOpenAIChatCompletions(req, res);
            }
            // Anthropic endpoints
            else if (url === '/v1/messages' || url === '/messages') {
                await this.handleAnthropicMessages(req, res);
            }
            // Utility endpoints
            else if (url === '/v1/health' || url === '/health') {
                await this.handleHealth(req, res);
            } else if (url === '/v1/stats' || url === '/stats') {
                await this.handleStats(req, res);
            } else if (url === '/v1/cache/stats' || url === '/cache/stats') {
                this.handleCacheStats(req, res);
            } else if (url === '/v1/cache/clear' || url === '/cache/clear') {
                this.handleCacheClear(req, res);
            } else if (url === '/' || url === '/v1') {
                this.handleRoot(req, res);
            } else {
                this.sendError(res, 404, 'not_found', `Unknown endpoint: ${url}`);
            }
        } catch (error) {
            console.error('Request error:', error);
            this.sendError(res, 500, 'internal_error', String(error));
        }
    }

    private handleRoot(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            name: 'GateX',
            version: '0.5.0',
            description: 'Your gateway to AI models - Better than Agent Maestro',
            features: [
                'OpenAI API compatible',
                'Anthropic API compatible', 
                'SSE Streaming',
                'Smart retry with exponential backoff',
                'Response caching',
                'Request queuing'
            ],
            endpoints: {
                openai: {
                    models: '/v1/models',
                    chat: '/v1/chat/completions'
                },
                anthropic: {
                    messages: '/v1/messages'
                },
                utility: {
                    health: '/v1/health',
                    stats: '/v1/stats',
                    cacheStats: '/v1/cache/stats',
                    cacheClear: '/v1/cache/clear'
                }
            }
        }, null, 2));
    }

    private async handleModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const models = await this.modelManager.getModels();
        
        const response = {
            object: 'list',
            data: models.map(m => ({
                id: m.id,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: m.vendor,
                name: m.name,
                context_window: m.maxInputTokens
            }))
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));
    }

    // ============================================================================
    // OpenAI API Handler
    // ============================================================================
    
    private async handleOpenAIChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST') {
            this.sendError(res, 405, 'method_not_allowed', 'Use POST');
            return;
        }

        const body = await this.parseBody(req);
        const request = JSON.parse(body) as OpenAIChatRequest;

        if (!request.model) {
            this.sendError(res, 400, 'invalid_request', 'model is required');
            return;
        }

        if (!request.messages || request.messages.length === 0) {
            this.sendError(res, 400, 'invalid_request', 'messages is required');
            return;
        }

        // Check cache first
        const cacheKey = responseCache.generateKey(request.model, request.messages);
        const cached = responseCache.get(cacheKey);
        if (cached && !request.stream) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ...cached, _cached: true }));
            return;
        }

        const model = await this.modelManager.getModel(request.model);
        if (!model) {
            this.sendError(res, 404, 'model_not_found', `Model '${request.model}' not available`);
            return;
        }

        // Convert to VS Code format
        const messages = this.convertToVSCodeMessages(request.messages);

        // Streaming response
        if (request.stream) {
            await this.handleOpenAIStream(res, model, request.model, messages);
            return;
        }

        // Non-streaming with queue and retry
        const config = vscode.workspace.getConfiguration('gatex');
        const timeout = (config.get<number>('timeout') || 300) * 1000;
        const maxRetries = config.get<number>('maxRetries') || 3;

        try {
            statsManager.connectionStart();
            
            const result = await requestQueue.enqueue(async () => {
                const startTime = Date.now();
                
                const cts = new vscode.CancellationTokenSource();
                const timeoutId = setTimeout(() => cts.cancel(), timeout);

                const response = await model.sendRequest(messages, {}, cts.token);
                
                let content = '';
                for await (const chunk of response.text) {
                    content += chunk;
                }

                clearTimeout(timeoutId);
                return { content, latency: Date.now() - startTime };
            }, { maxRetries });

            // Estimate tokens
            const inputTokens = request.messages.reduce((sum, m) => sum + StatsManager.estimateTokens(m.content), 0);
            const outputTokens = StatsManager.estimateTokens(result.content);

            statsManager.recordRequest({
                timestamp: Date.now(),
                model: request.model,
                latency: result.latency,
                inputTokens,
                outputTokens,
                success: true
            });
            statsManager.connectionEnd();

            const response = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: result.content },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: inputTokens,
                    completion_tokens: outputTokens,
                    total_tokens: inputTokens + outputTokens
                },
                _gatex: {
                    latency_ms: result.latency,
                    queue_stats: requestQueue.getStats()
                }
            };

            // Cache the response
            responseCache.set(cacheKey, response);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));

        } catch (error: any) {
            statsManager.connectionEnd();
            statsManager.recordRequest({
                timestamp: Date.now(),
                model: request.model,
                latency: 0,
                inputTokens: 0,
                outputTokens: 0,
                success: false,
                error: error.message
            });

            if (error.message?.includes('cancelled')) {
                this.sendError(res, 408, 'timeout', `Request exceeded ${timeout/1000}s timeout`);
            } else {
                this.sendError(res, 500, 'model_error', error.message || String(error));
            }
        }
    }

    private async handleOpenAIStream(
        res: http.ServerResponse, 
        model: vscode.LanguageModelChat, 
        modelId: string,
        messages: vscode.LanguageModelChatMessage[]
    ): Promise<void> {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const config = vscode.workspace.getConfiguration('gatex');
        const timeout = (config.get<number>('timeout') || 300) * 1000;
        const streamId = `chatcmpl-${Date.now()}`;

        try {
            statsManager.connectionStart();
            const startTime = Date.now();

            const cts = new vscode.CancellationTokenSource();
            const timeoutId = setTimeout(() => cts.cancel(), timeout);

            const response = await model.sendRequest(messages, {}, cts.token);
            
            let fullContent = '';
            for await (const chunk of response.text) {
                fullContent += chunk;
                
                const data = {
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: modelId,
                    choices: [{
                        index: 0,
                        delta: { content: chunk },
                        finish_reason: null
                    }]
                };

                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }

            clearTimeout(timeoutId);

            // Send final chunk
            const finalData = {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            };
            res.write(`data: ${JSON.stringify(finalData)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();

            const latency = Date.now() - startTime;
            statsManager.recordRequest({
                timestamp: Date.now(),
                model: modelId,
                latency,
                inputTokens: 0,
                outputTokens: StatsManager.estimateTokens(fullContent),
                success: true
            });
            statsManager.connectionEnd();

        } catch (error: any) {
            statsManager.connectionEnd();
            
            const errorData = {
                error: { message: error.message || String(error), type: 'stream_error' }
            };
            res.write(`data: ${JSON.stringify(errorData)}\n\n`);
            res.end();
        }
    }

    // ============================================================================
    // Anthropic API Handler
    // ============================================================================

    private async handleAnthropicMessages(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST') {
            this.sendError(res, 405, 'method_not_allowed', 'Use POST');
            return;
        }

        const body = await this.parseBody(req);
        const request = JSON.parse(body) as AnthropicRequest;

        if (!request.model) {
            this.sendAnthropicError(res, 400, 'invalid_request_error', 'model is required');
            return;
        }

        if (!request.messages || request.messages.length === 0) {
            this.sendAnthropicError(res, 400, 'invalid_request_error', 'messages is required');
            return;
        }

        // Map Anthropic model names to available models
        const modelMapping: { [key: string]: string } = {
            'claude-3-opus-20240229': 'claude-3-opus',
            'claude-3-sonnet-20240229': 'claude-3-sonnet',
            'claude-3-haiku-20240307': 'claude-3-haiku',
            'claude-sonnet-4-20250514': 'claude-sonnet-4',
            'claude-3-5-sonnet-20241022': 'claude-3.5-sonnet'
        };

        const mappedModel = modelMapping[request.model] || request.model;
        const model = await this.modelManager.getModel(mappedModel);
        
        if (!model) {
            this.sendAnthropicError(res, 404, 'not_found_error', `Model '${request.model}' not available`);
            return;
        }

        // Convert Anthropic format to VS Code format
        const messages = this.convertAnthropicToVSCodeMessages(request.messages, request.system);

        // Streaming
        if (request.stream) {
            await this.handleAnthropicStream(res, model, request.model, messages);
            return;
        }

        // Non-streaming
        const config = vscode.workspace.getConfiguration('gatex');
        const timeout = (config.get<number>('timeout') || 300) * 1000;
        const maxRetries = config.get<number>('maxRetries') || 3;

        try {
            statsManager.connectionStart();

            const result = await requestQueue.enqueue(async () => {
                const startTime = Date.now();
                
                const cts = new vscode.CancellationTokenSource();
                const timeoutId = setTimeout(() => cts.cancel(), timeout);

                const response = await model.sendRequest(messages, {}, cts.token);
                
                let content = '';
                for await (const chunk of response.text) {
                    content += chunk;
                }

                clearTimeout(timeoutId);
                return { content, latency: Date.now() - startTime };
            }, { maxRetries });

            const inputTokens = StatsManager.estimateTokens(JSON.stringify(request.messages));
            const outputTokens = StatsManager.estimateTokens(result.content);

            statsManager.recordRequest({
                timestamp: Date.now(),
                model: request.model,
                latency: result.latency,
                inputTokens,
                outputTokens,
                success: true
            });
            statsManager.connectionEnd();

            // Anthropic response format
            const response = {
                id: `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [{
                    type: 'text',
                    text: result.content
                }],
                model: request.model,
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: outputTokens
                }
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));

        } catch (error: any) {
            statsManager.connectionEnd();
            this.sendAnthropicError(res, 500, 'api_error', error.message || String(error));
        }
    }

    private async handleAnthropicStream(
        res: http.ServerResponse,
        model: vscode.LanguageModelChat,
        modelId: string,
        messages: vscode.LanguageModelChatMessage[]
    ): Promise<void> {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const config = vscode.workspace.getConfiguration('gatex');
        const timeout = (config.get<number>('timeout') || 300) * 1000;
        const messageId = `msg_${Date.now()}`;

        try {
            statsManager.connectionStart();
            const startTime = Date.now();

            // Send message_start
            res.write(`event: message_start\ndata: ${JSON.stringify({
                type: 'message_start',
                message: {
                    id: messageId,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model: modelId,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            })}\n\n`);

            // Send content_block_start
            res.write(`event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' }
            })}\n\n`);

            const cts = new vscode.CancellationTokenSource();
            const timeoutId = setTimeout(() => cts.cancel(), timeout);

            const response = await model.sendRequest(messages, {}, cts.token);
            
            let fullContent = '';
            for await (const chunk of response.text) {
                fullContent += chunk;
                
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: chunk }
                })}\n\n`);
            }

            clearTimeout(timeoutId);

            // Send content_block_stop
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: 0
            })}\n\n`);

            // Send message_delta
            res.write(`event: message_delta\ndata: ${JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: StatsManager.estimateTokens(fullContent) }
            })}\n\n`);

            // Send message_stop
            res.write(`event: message_stop\ndata: ${JSON.stringify({
                type: 'message_stop'
            })}\n\n`);

            res.end();

            const latency = Date.now() - startTime;
            statsManager.recordRequest({
                timestamp: Date.now(),
                model: modelId,
                latency,
                inputTokens: 0,
                outputTokens: StatsManager.estimateTokens(fullContent),
                success: true
            });
            statsManager.connectionEnd();

        } catch (error: any) {
            statsManager.connectionEnd();
            
            res.write(`event: error\ndata: ${JSON.stringify({
                type: 'error',
                error: { type: 'api_error', message: error.message || String(error) }
            })}\n\n`);
            res.end();
        }
    }

    // ============================================================================
    // Utility Handlers
    // ============================================================================

    private async handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const models = await this.modelManager.getModels();
        const queueStats = requestQueue.getStats();
        const cacheStats = responseCache.getStats();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            server: 'GateX',
            version: '0.5.0',
            port: this.port,
            models: models.length,
            queue: queueStats,
            cache: cacheStats,
            timestamp: new Date().toISOString()
        }, null, 2));
    }

    private async handleStats(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const stats = statsManager.getStats();
        const queueStats = requestQueue.getStats();
        const cacheStats = responseCache.getStats();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            uptime: stats.uptime,
            totalRequests: stats.global.totalRequests,
            activeConnections: stats.global.activeConnections,
            totalInputTokens: stats.global.totalInputTokens,
            totalOutputTokens: stats.global.totalOutputTokens,
            avgLatency: Math.round(stats.avgLatency),
            successRate: parseFloat(stats.successRate.toFixed(2)),
            rpm: stats.rpm,
            tpm: stats.tpm,
            queue: queueStats,
            cache: cacheStats
        }, null, 2));
    }

    private handleCacheStats(req: http.IncomingMessage, res: http.ServerResponse): void {
        const stats = responseCache.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
    }

    private handleCacheClear(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (req.method !== 'POST') {
            this.sendError(res, 405, 'method_not_allowed', 'Use POST');
            return;
        }
        
        responseCache.clear();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private convertToVSCodeMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
        return messages.map(m => {
            if (m.role === 'user' || m.role === 'system') {
                return vscode.LanguageModelChatMessage.User(m.content);
            } else {
                return vscode.LanguageModelChatMessage.Assistant(m.content);
            }
        });
    }

    private convertAnthropicToVSCodeMessages(
        messages: AnthropicMessage[], 
        system?: string
    ): vscode.LanguageModelChatMessage[] {
        const result: vscode.LanguageModelChatMessage[] = [];

        // Add system message first if present
        if (system) {
            result.push(vscode.LanguageModelChatMessage.User(system));
        }

        for (const m of messages) {
            const content = typeof m.content === 'string' 
                ? m.content 
                : m.content.map(c => c.text).join('');

            if (m.role === 'user') {
                result.push(vscode.LanguageModelChatMessage.User(content));
            } else {
                result.push(vscode.LanguageModelChatMessage.Assistant(content));
            }
        }

        return result;
    }

    private parseBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }

    private sendError(res: http.ServerResponse, status: number, code: string, message: string): void {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { code, message, type: 'error' }
        }));
    }

    private sendAnthropicError(res: http.ServerResponse, status: number, type: string, message: string): void {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            type: 'error',
            error: { type, message }
        }));
    }
}
