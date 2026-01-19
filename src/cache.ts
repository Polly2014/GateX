/**
 * GateX Response Cache
 * 
 * LRU Cache for API responses to reduce redundant requests
 */

import * as crypto from 'crypto';

interface CacheEntry {
    response: any;
    timestamp: number;
    hits: number;
    size: number;
}

interface CacheStats {
    hits: number;
    misses: number;
    entries: number;
    totalSize: number;
    hitRate: number;
}

export class ResponseCache {
    private cache: Map<string, CacheEntry> = new Map();
    private maxSize: number;
    private maxAge: number;  // milliseconds
    private hits: number = 0;
    private misses: number = 0;
    private enabled: boolean = true;

    /**
     * @param maxSize Maximum cache size in bytes (default 50MB)
     * @param maxAge Maximum age in milliseconds (default 5 minutes)
     */
    constructor(maxSize: number = 50 * 1024 * 1024, maxAge: number = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.maxAge = maxAge;
    }

    /**
     * Generate cache key from request
     */
    generateKey(model: string, messages: any[], options?: any): string {
        const payload = JSON.stringify({ model, messages, options });
        return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16);
    }

    /**
     * Get cached response
     */
    get(key: string): any | null {
        if (!this.enabled) {
            return null;
        }

        const entry = this.cache.get(key);
        
        if (!entry) {
            this.misses++;
            return null;
        }

        // Check if expired
        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }

        entry.hits++;
        this.hits++;
        
        // Move to end (LRU)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.response;
    }

    /**
     * Set cache entry
     */
    set(key: string, response: any): void {
        if (!this.enabled) {
            return;
        }

        const size = this.estimateSize(response);

        // Evict if necessary
        this.evictIfNeeded(size);

        this.cache.set(key, {
            response,
            timestamp: Date.now(),
            hits: 0,
            size
        });
    }

    /**
     * Check if key exists and is valid
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;
        
        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            return false;
        }
        
        return true;
    }

    /**
     * Delete cache entry
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Enable/disable cache
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        let totalSize = 0;
        for (const entry of this.cache.values()) {
            totalSize += entry.size;
        }

        const total = this.hits + this.misses;
        const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

        return {
            hits: this.hits,
            misses: this.misses,
            entries: this.cache.size,
            totalSize,
            hitRate
        };
    }

    private evictIfNeeded(newSize: number): void {
        let totalSize = 0;
        for (const entry of this.cache.values()) {
            totalSize += entry.size;
        }

        // Evict oldest entries until we have space
        while (totalSize + newSize > this.maxSize && this.cache.size > 0) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                const entry = this.cache.get(oldestKey);
                if (entry) {
                    totalSize -= entry.size;
                }
                this.cache.delete(oldestKey);
            }
        }
    }

    private estimateSize(obj: any): number {
        const str = JSON.stringify(obj);
        // Rough estimate: 2 bytes per character (UTF-16)
        return str.length * 2;
    }
}

// Singleton instance
export const responseCache = new ResponseCache();
