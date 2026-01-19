/**
 * GateX Model Manager
 * 
 * Manages VS Code LLM providers
 */

import * as vscode from 'vscode';

export interface ModelInfo {
    id: string;
    name: string;
    vendor: string;
    family: string;
    maxInputTokens: number | undefined;
}

export interface HealthCheckResult {
    total: number;
    healthy: number;
    unhealthy: number;
    results: Map<string, { status: string; latency?: number }>;
}

export class ModelManager {
    private modelCache: vscode.LanguageModelChat[] | null = null;
    private cacheTime: number = 0;
    private readonly CACHE_TTL = 30000; // 30 seconds

    /**
     * Get all available models
     */
    async getModels(): Promise<ModelInfo[]> {
        const models = await this.fetchModels();
        
        return models.map(m => ({
            id: m.id,
            name: m.name,
            vendor: m.vendor,
            family: m.family,
            maxInputTokens: m.maxInputTokens
        }));
    }

    /**
     * Get model count
     */
    async getModelCount(): Promise<number> {
        const models = await this.fetchModels();
        return models.length;
    }

    /**
     * Get a specific model by ID
     */
    async getModel(modelId: string): Promise<vscode.LanguageModelChat | undefined> {
        const models = await this.fetchModels();
        
        // Try exact match first
        let model = models.find(m => m.id === modelId);
        
        // Try partial match (e.g., 'gpt-4o' matches 'copilot-gpt-4o')
        if (!model) {
            model = models.find(m => 
                m.id.includes(modelId) || 
                m.family === modelId ||
                m.name.toLowerCase().includes(modelId.toLowerCase())
            );
        }
        
        return model;
    }

    /**
     * Perform health check on all models (PARALLEL execution with real-time progress)
     */
    async healthCheck(
        onProgress?: (model: ModelInfo, status: string, latency?: number) => void
    ): Promise<HealthCheckResult> {
        const models = await this.fetchModels();
        const results: HealthCheckResult = {
            total: models.length,
            healthy: 0,
            unhealthy: 0,
            results: new Map()
        };

        if (models.length === 0) {
            return results;
        }

        // Execute health checks with real-time progress callback
        const checkPromises = models.map(async (model) => {
            const info: ModelInfo = {
                id: model.id,
                name: model.name,
                vendor: model.vendor,
                family: model.family,
                maxInputTokens: model.maxInputTokens
            };

            try {
                const startTime = Date.now();
                
                const messages = [
                    vscode.LanguageModelChatMessage.User('Say "OK" only.')
                ];

                const cts = new vscode.CancellationTokenSource();
                const timeoutId = setTimeout(() => cts.cancel(), 30000); // 30s timeout

                const response = await model.sendRequest(messages, {}, cts.token);
                
                let text = '';
                for await (const chunk of response.text) {
                    text += chunk;
                    if (text.length > 100) break;
                }

                clearTimeout(timeoutId);
                const latency = Date.now() - startTime;

                // Immediately call onProgress for this model
                results.healthy++;
                results.results.set(model.id, { status: 'healthy', latency });
                if (onProgress) {
                    onProgress(info, 'healthy', latency);
                }

                return { info, status: 'healthy' as const, latency };

            } catch (error: any) {
                const errorMsg = error.message || String(error);
                
                // Immediately call onProgress for this model
                results.unhealthy++;
                results.results.set(model.id, { status: errorMsg });
                if (onProgress) {
                    onProgress(info, 'error');
                }

                return { info, status: 'error' as const, error: errorMsg };
            }
        });

        // Wait for all checks to complete (using allSettled to handle any rejections)
        await Promise.allSettled(checkPromises);

        return results;
    }

    /**
     * Fetch models from VS Code (with caching)
     */
    private async fetchModels(): Promise<vscode.LanguageModelChat[]> {
        const now = Date.now();
        
        if (this.modelCache && (now - this.cacheTime) < this.CACHE_TTL) {
            return this.modelCache;
        }

        try {
            this.modelCache = await vscode.lm.selectChatModels({});
            this.cacheTime = now;
            return this.modelCache;
        } catch (error) {
            console.error('Failed to fetch models:', error);
            return this.modelCache || [];
        }
    }

    /**
     * Clear model cache
     */
    clearCache(): void {
        this.modelCache = null;
        this.cacheTime = 0;
    }
}
