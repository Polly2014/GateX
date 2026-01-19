/**
 * GateX Request Queue & Smart Retry
 * 
 * Handles concurrent requests with rate limiting and intelligent retry
 */

interface QueuedRequest<T> {
    id: string;
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    retries: number;
    maxRetries: number;
    priority: number;
    timestamp: number;
}

interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    retried: number;
}

export class RequestQueue {
    private queue: QueuedRequest<any>[] = [];
    private processing: Map<string, QueuedRequest<any>> = new Map();
    private maxConcurrent: number;
    private stats: QueueStats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        retried: 0
    };

    constructor(maxConcurrent: number = 3) {
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Add a request to the queue with smart retry
     */
    async enqueue<T>(
        execute: () => Promise<T>,
        options: {
            priority?: number;
            maxRetries?: number;
            retryDelay?: number;
        } = {}
    ): Promise<T> {
        const { priority = 0, maxRetries = 3 } = options;
        
        return new Promise((resolve, reject) => {
            const request: QueuedRequest<T> = {
                id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                execute,
                resolve,
                reject,
                retries: 0,
                maxRetries,
                priority,
                timestamp: Date.now()
            };

            // Insert based on priority (higher priority first)
            const insertIndex = this.queue.findIndex(r => r.priority < priority);
            if (insertIndex === -1) {
                this.queue.push(request);
            } else {
                this.queue.splice(insertIndex, 0, request);
            }

            this.stats.pending++;
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        while (this.processing.size < this.maxConcurrent && this.queue.length > 0) {
            const request = this.queue.shift()!;
            this.stats.pending--;
            this.stats.processing++;
            this.processing.set(request.id, request);

            this.executeRequest(request);
        }
    }

    private async executeRequest<T>(request: QueuedRequest<T>): Promise<void> {
        try {
            const result = await request.execute();
            this.stats.completed++;
            request.resolve(result);
        } catch (error: any) {
            // Check if retryable
            if (this.isRetryable(error) && request.retries < request.maxRetries) {
                request.retries++;
                this.stats.retried++;
                
                // Exponential backoff: 1s, 2s, 4s...
                const delay = Math.pow(2, request.retries - 1) * 1000;
                
                console.log(`[GateX] Retrying request ${request.id} (attempt ${request.retries}/${request.maxRetries}) after ${delay}ms`);
                
                await this.sleep(delay);
                
                // Re-add to front of queue
                this.queue.unshift(request);
                this.stats.pending++;
            } else {
                this.stats.failed++;
                request.reject(error);
            }
        } finally {
            this.stats.processing--;
            this.processing.delete(request.id);
            this.processQueue();
        }
    }

    private isRetryable(error: any): boolean {
        const message = error.message?.toLowerCase() || '';
        
        // Retryable errors
        const retryablePatterns = [
            'timeout',
            'rate limit',
            'too many requests',
            '429',
            '500',
            '502',
            '503',
            '504',
            'network',
            'econnreset',
            'econnrefused',
            'socket hang up'
        ];

        // Non-retryable errors
        const nonRetryablePatterns = [
            'cancelled',
            'invalid',
            'unauthorized',
            '401',
            '403',
            '404'
        ];

        // Check non-retryable first
        if (nonRetryablePatterns.some(p => message.includes(p))) {
            return false;
        }

        return retryablePatterns.some(p => message.includes(p));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStats(): QueueStats {
        return { ...this.stats };
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    getProcessingCount(): number {
        return this.processing.size;
    }

    clear(): void {
        for (const request of this.queue) {
            request.reject(new Error('Queue cleared'));
        }
        this.queue = [];
        this.stats.pending = 0;
    }
}

// Singleton instance
export const requestQueue = new RequestQueue(5);
