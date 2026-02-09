/**
 * GateX HTTP Server v2
 * 
 * Lean and focused:
 * - OpenAI API compatible (/v1/chat/completions)
 * - Anthropic API compatible (/v1/messages)
 * - SSE Streaming support
 * - Simple retry with exponential backoff
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { ModelManager } from './models';

// ============================================================================
// Types
// ============================================================================

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenAIChatRequest {
    model: string;
    messages: ChatMessage[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
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
    temperature?: number;
    top_p?: number;
    stream?: boolean;
}

// ============================================================================
// Server
// ============================================================================

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
        return 0; // OS will assign one
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

    // ============================================================================
    // Request Router
    // ============================================================================

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
            if (url === '/v1/models' || url === '/models') {
                await this.handleModels(req, res);
            } else if (url === '/v1/chat/completions' || url === '/chat/completions') {
                await this.handleOpenAIChatCompletions(req, res);
            } else if (url === '/v1/messages' || url === '/messages') {
                await this.handleAnthropicMessages(req, res);
            } else if (url === '/v1/health' || url === '/health') {
                await this.handleHealth(req, res);
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

    // ============================================================================
    // Root / Models / Health
    // ============================================================================

    private handleRoot(_req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            name: 'GateX',
            version: '1.0.0',
            description: 'Your gateway to AI models',
            endpoints: {
                openai: {
                    models: '/v1/models',
                    chat: '/v1/chat/completions'
                },
                anthropic: {
                    messages: '/v1/messages'
                },
                utility: {
                    health: '/v1/health'
                }
            }
        }, null, 2));
    }

    private async handleModels(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const models = await this.modelManager.getModels();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            object: 'list',
            data: models.map(m => ({
                id: m.id,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: m.vendor,
                name: m.name,
                context_window: m.maxInputTokens
            }))
        }, null, 2));
    }

    private async handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const models = await this.modelManager.getModels();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            server: 'GateX',
            version: '1.0.0',
            port: this.port,
            models: models.length,
            timestamp: new Date().toISOString()
        }, null, 2));
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

        let request: OpenAIChatRequest;
        try {
            request = JSON.parse(body) as OpenAIChatRequest;
        } catch {
            this.sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
            return;
        }

        if (!request.model) {
            this.sendError(res, 400, 'invalid_request', 'model is required');
            return;
        }

        if (!request.messages || request.messages.length === 0) {
            this.sendError(res, 400, 'invalid_request', 'messages is required');
            return;
        }

        const model = await this.modelManager.getModel(request.model);
        if (!model) {
            this.sendError(res, 404, 'model_not_found', `Model '${request.model}' not available`);
            return;
        }

        const messages = this.convertToVSCodeMessages(request.messages);
        const modelOptions = this.buildModelOptions(request);

        if (request.stream) {
            await this.handleOpenAIStream(res, model, request.model, messages, modelOptions);
            return;
        }

        // Non-streaming with retry
        const config = vscode.workspace.getConfiguration('gatex');
        const timeout = (config.get<number>('timeout') || 300) * 1000;
        const maxRetries = config.get<number>('maxRetries') || 3;

        try {
            const result = await this.executeWithRetry(async () => {
                const startTime = Date.now();

                const cts = new vscode.CancellationTokenSource();
                const timeoutId = setTimeout(() => cts.cancel(), timeout);

                try {
                    const response = await model.sendRequest(messages, modelOptions, cts.token);
                    
                    let content = '';
                    for await (const chunk of response.text) {
                        content += chunk;
                    }

                    clearTimeout(timeoutId);
                    return { content, latency: Date.now() - startTime };
                } catch (error) {
                    clearTimeout(timeoutId);
                    throw error;
                }
            }, maxRetries);

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
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));

        } catch (error: any) {
            if (error.message?.includes('cancelled')) {
                this.sendError(res, 408, 'timeout', `Request exceeded ${timeout / 1000}s timeout`);
            } else {
                this.sendError(res, 500, 'model_error', error.message || String(error));
            }
        }
    }

    private async handleOpenAIStream(
        res: http.ServerResponse,
        model: vscode.LanguageModelChat,
        modelId: string,
        messages: vscode.LanguageModelChatMessage[],
        modelOptions: Record<string, any>
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
            const cts = new vscode.CancellationTokenSource();
            const timeoutId = setTimeout(() => cts.cancel(), timeout);

            const response = await model.sendRequest(messages, modelOptions, cts.token);

            for await (const chunk of response.text) {
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

            // Final chunk
            res.write(`data: ${JSON.stringify({
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();

        } catch (error: any) {
            res.write(`data: ${JSON.stringify({
                error: { message: error.message || String(error), type: 'stream_error' }
            })}\n\n`);
            res.end();
        }
    }

    // ============================================================================
    // Anthropic API Handler
    // ============================================================================

    private async handleAnthropicMessages(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST') {
            this.sendAnthropicError(res, 405, 'method_not_allowed', 'Use POST');
            return;
        }

        const body = await this.parseBody(req);

        let request: AnthropicRequest;
        try {
            request = JSON.parse(body) as AnthropicRequest;
        } catch {
            this.sendAnthropicError(res, 400, 'invalid_request_error', 'Request body is not valid JSON');
            return;
        }

        if (!request.model) {
            this.sendAnthropicError(res, 400, 'invalid_request_error', 'model is required');
            return;
        }

        if (!request.messages || request.messages.length === 0) {
            this.sendAnthropicError(res, 400, 'invalid_request_error', 'messages is required');
            return;
        }

        // Use dynamic model matching (no hardcoded mapping)
        const model = await this.modelManager.getModel(request.model);
        if (!model) {
            this.sendAnthropicError(res, 404, 'not_found_error', `Model '${request.model}' not available`);
            return;
        }

        const messages = this.convertAnthropicToVSCodeMessages(request.messages, request.system);
        const modelOptions = this.buildModelOptions(request);

        if (request.stream) {
            await this.handleAnthropicStream(res, model, request.model, messages, modelOptions);
            return;
        }

        // Non-streaming with retry
        const config = vscode.workspace.getConfiguration('gatex');
        const timeout = (config.get<number>('timeout') || 300) * 1000;
        const maxRetries = config.get<number>('maxRetries') || 3;

        try {
            const result = await this.executeWithRetry(async () => {
                const startTime = Date.now();

                const cts = new vscode.CancellationTokenSource();
                const timeoutId = setTimeout(() => cts.cancel(), timeout);

                try {
                    const response = await model.sendRequest(messages, modelOptions, cts.token);
                    
                    let content = '';
                    for await (const chunk of response.text) {
                        content += chunk;
                    }

                    clearTimeout(timeoutId);
                    return { content, latency: Date.now() - startTime };
                } catch (error) {
                    clearTimeout(timeoutId);
                    throw error;
                }
            }, maxRetries);

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
                    input_tokens: 0,
                    output_tokens: 0
                }
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));

        } catch (error: any) {
            this.sendAnthropicError(res, 500, 'api_error', error.message || String(error));
        }
    }

    private async handleAnthropicStream(
        res: http.ServerResponse,
        model: vscode.LanguageModelChat,
        modelId: string,
        messages: vscode.LanguageModelChatMessage[],
        modelOptions: Record<string, any>
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
            // message_start
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

            // content_block_start
            res.write(`event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' }
            })}\n\n`);

            const cts = new vscode.CancellationTokenSource();
            const timeoutId = setTimeout(() => cts.cancel(), timeout);

            const response = await model.sendRequest(messages, modelOptions, cts.token);

            for await (const chunk of response.text) {
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: chunk }
                })}\n\n`);
            }

            clearTimeout(timeoutId);

            // content_block_stop
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                type: 'content_block_stop',
                index: 0
            })}\n\n`);

            // message_delta
            res.write(`event: message_delta\ndata: ${JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: 0 }
            })}\n\n`);

            // message_stop
            res.write(`event: message_stop\ndata: ${JSON.stringify({
                type: 'message_stop'
            })}\n\n`);

            res.end();

        } catch (error: any) {
            res.write(`event: error\ndata: ${JSON.stringify({
                type: 'error',
                error: { type: 'api_error', message: error.message || String(error) }
            })}\n\n`);
            res.end();
        }
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    /**
     * Build model options from request parameters.
     * Passes temperature/max_tokens/top_p via modelOptions for forward compatibility.
     * Note: VS Code LM API may not honor all parameters — the underlying provider decides.
     */
    private buildModelOptions(request: OpenAIChatRequest | AnthropicRequest): Record<string, any> {
        const opts: Record<string, any> = {};

        if (request.temperature !== undefined) {
            opts['temperature'] = request.temperature;
        }
        if (request.max_tokens !== undefined) {
            opts['max_tokens'] = request.max_tokens;
        }
        if ('top_p' in request && request.top_p !== undefined) {
            opts['top_p'] = request.top_p;
        }

        if (Object.keys(opts).length > 0) {
            return { modelOptions: opts } as any;
        }
        return {};
    }

    /**
     * Execute a function with exponential backoff retry.
     */
    private async executeWithRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;
                if (attempt < maxRetries && this.isRetryable(error)) {
                    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                    console.log(`[GateX] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw error;
            }
        }

        throw lastError;
    }

    private isRetryable(error: any): boolean {
        const message = (error.message || '').toLowerCase();
        const retryable = ['timeout', 'rate limit', 'too many requests', '429', '500', '502', '503', '504', 'econnreset', 'socket hang up'];
        const nonRetryable = ['cancelled', 'invalid', 'unauthorized', '401', '403', '404'];

        if (nonRetryable.some(p => message.includes(p))) {
            return false;
        }
        return retryable.some(p => message.includes(p));
    }

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
            req.on('data', (chunk: Buffer) => body += chunk);
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
