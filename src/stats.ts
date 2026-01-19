/**
 * GateX Statistics & Metrics
 * 
 * Real-time traffic and usage tracking like ClashX
 */

export interface RequestStats {
    timestamp: number;
    model: string;
    latency: number;
    inputTokens: number;
    outputTokens: number;
    success: boolean;
    error?: string;
}

export interface ModelStats {
    totalRequests: number;
    successRequests: number;
    failedRequests: number;
    totalLatency: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    lastRequest?: number;
    lastLatency?: number;
    status: 'unknown' | 'healthy' | 'degraded' | 'error' | 'checking';
    lastError?: string;
}

export interface GlobalStats {
    startTime: number;
    totalRequests: number;
    activeConnections: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestsPerMinute: number[];  // Last 60 minutes
    tokensPerMinute: number[];    // Last 60 minutes
}

type StatsChangeCallback = (stats: StatsManager) => void;

export class StatsManager {
    private modelStats: Map<string, ModelStats> = new Map();
    private recentRequests: RequestStats[] = [];
    private globalStats: GlobalStats;
    private callbacks: Set<StatsChangeCallback> = new Set();
    private rpmHistory: number[] = [];
    private tpmHistory: number[] = [];
    private lastMinute: number = 0;
    private currentMinuteRequests: number = 0;
    private currentMinuteTokens: number = 0;

    constructor() {
        this.globalStats = {
            startTime: Date.now(),
            totalRequests: 0,
            activeConnections: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            requestsPerMinute: [],
            tokensPerMinute: []
        };

        // Update RPM/TPM every minute
        setInterval(() => this.updateMinuteStats(), 60000);
    }

    /**
     * Record a new request
     */
    recordRequest(stats: RequestStats): void {
        // Add to recent requests (keep last 1000)
        this.recentRequests.push(stats);
        if (this.recentRequests.length > 1000) {
            this.recentRequests.shift();
        }

        // Update global stats
        this.globalStats.totalRequests++;
        this.globalStats.totalInputTokens += stats.inputTokens;
        this.globalStats.totalOutputTokens += stats.outputTokens;
        this.currentMinuteRequests++;
        this.currentMinuteTokens += stats.inputTokens + stats.outputTokens;

        // Update model stats
        let modelStat = this.modelStats.get(stats.model);
        if (!modelStat) {
            modelStat = {
                totalRequests: 0,
                successRequests: 0,
                failedRequests: 0,
                totalLatency: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                status: 'unknown'
            };
            this.modelStats.set(stats.model, modelStat);
        }

        modelStat.totalRequests++;
        modelStat.totalLatency += stats.latency;
        modelStat.totalInputTokens += stats.inputTokens;
        modelStat.totalOutputTokens += stats.outputTokens;
        modelStat.lastRequest = stats.timestamp;
        modelStat.lastLatency = stats.latency;

        if (stats.success) {
            modelStat.successRequests++;
            // Update status based on latency
            if (stats.latency < 5000) {
                modelStat.status = 'healthy';
            } else if (stats.latency < 15000) {
                modelStat.status = 'degraded';
            }
        } else {
            modelStat.failedRequests++;
            modelStat.status = 'error';
            modelStat.lastError = stats.error;
        }

        this.notifyChange();
    }

    /**
     * Increment active connections
     */
    connectionStart(): void {
        this.globalStats.activeConnections++;
        this.notifyChange();
    }

    /**
     * Decrement active connections
     */
    connectionEnd(): void {
        this.globalStats.activeConnections = Math.max(0, this.globalStats.activeConnections - 1);
        this.notifyChange();
    }

    /**
     * Update model health status
     */
    updateModelStatus(modelId: string, status: 'healthy' | 'degraded' | 'error', latency?: number): void {
        let modelStat = this.modelStats.get(modelId);
        if (!modelStat) {
            modelStat = {
                totalRequests: 0,
                successRequests: 0,
                failedRequests: 0,
                totalLatency: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                status: 'unknown'
            };
            this.modelStats.set(modelId, modelStat);
        }
        modelStat.status = status;
        if (latency !== undefined) {
            modelStat.lastLatency = latency;
        }
        this.notifyChange();
    }

    /**
     * Get all stats for dashboard
     */
    getStats(): {
        global: GlobalStats;
        models: Map<string, ModelStats>;
        recentRequests: RequestStats[];
        uptime: number;
        avgLatency: number;
        successRate: number;
        rpm: number;
        tpm: number;
    } {
        const uptime = Date.now() - this.globalStats.startTime;
        
        // Calculate average latency
        let totalLatency = 0;
        let latencyCount = 0;
        for (const stat of this.modelStats.values()) {
            if (stat.totalRequests > 0) {
                totalLatency += stat.totalLatency;
                latencyCount += stat.totalRequests;
            }
        }
        const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

        // Calculate success rate
        let totalSuccess = 0;
        let totalFailed = 0;
        for (const stat of this.modelStats.values()) {
            totalSuccess += stat.successRequests;
            totalFailed += stat.failedRequests;
        }
        const total = totalSuccess + totalFailed;
        const successRate = total > 0 ? (totalSuccess / total) * 100 : 100;

        // Current RPM/TPM
        const rpm = this.currentMinuteRequests;
        const tpm = this.currentMinuteTokens;

        return {
            global: this.globalStats,
            models: this.modelStats,
            recentRequests: this.recentRequests.slice(-50),
            uptime,
            avgLatency,
            successRate,
            rpm,
            tpm
        };
    }

    /**
     * Get model stats
     */
    getModelStats(modelId: string): ModelStats | undefined {
        return this.modelStats.get(modelId);
    }

    /**
     * Subscribe to stats changes
     */
    onChange(callback: StatsChangeCallback): () => void {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    private notifyChange(): void {
        for (const callback of this.callbacks) {
            try {
                callback(this);
            } catch (e) {
                console.error('Stats callback error:', e);
            }
        }
    }

    private updateMinuteStats(): void {
        // Save current minute stats
        this.rpmHistory.push(this.currentMinuteRequests);
        this.tpmHistory.push(this.currentMinuteTokens);

        // Keep last 60 minutes
        if (this.rpmHistory.length > 60) {
            this.rpmHistory.shift();
        }
        if (this.tpmHistory.length > 60) {
            this.tpmHistory.shift();
        }

        this.globalStats.requestsPerMinute = [...this.rpmHistory];
        this.globalStats.tokensPerMinute = [...this.tpmHistory];

        // Reset current minute
        this.currentMinuteRequests = 0;
        this.currentMinuteTokens = 0;
        this.lastMinute = Date.now();

        this.notifyChange();
    }

    /**
     * Estimate token count (rough approximation)
     */
    static estimateTokens(text: string): number {
        // Rough estimation: ~4 chars per token for English, ~2 for CJK
        const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
        const otherCount = text.length - cjkCount;
        return Math.ceil(cjkCount / 1.5 + otherCount / 4);
    }
}

// Singleton instance
export const statsManager = new StatsManager();
