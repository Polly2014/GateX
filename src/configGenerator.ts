/**
 * GateX Config Generator
 * 
 * Generate IDE configurations for connecting to GateX.
 * Supports: Claude Code, .env files, clipboard export.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelManager, ModelInfo } from './models';

interface IDEOption {
    label: string;
    id: string;
    description: string;
}

export class ConfigGenerator {
    private port: number;
    private modelManager: ModelManager;

    constructor(port: number, modelManager: ModelManager) {
        this.port = port;
        this.modelManager = modelManager;
    }

    /**
     * Main entry point — run the interactive config generation flow.
     */
    async run(): Promise<void> {
        const ideOptions: IDEOption[] = [
            { label: '$(file-code) Claude Code', id: 'claude-code', description: '.claude/settings.json' },
            { label: '$(file) .env File', id: 'dotenv', description: 'Generate .env with API endpoints' },
            { label: '$(clippy) Copy Env Vars', id: 'clipboard', description: 'Copy export commands to clipboard' },
        ];

        const selected = await vscode.window.showQuickPick(ideOptions, {
            title: '⚡ GateX — Configure for IDE',
            placeHolder: 'Select target configuration'
        });

        if (!selected) { return; }

        switch (selected.id) {
            case 'claude-code':
                await this.configureClaudeCode();
                break;
            case 'dotenv':
                await this.configureDotEnv();
                break;
            case 'clipboard':
                await this.copyEnvVars();
                break;
        }
    }

    // ========================================================================
    // Claude Code Configuration
    // ========================================================================

    private async configureClaudeCode(): Promise<void> {
        // Step 1: Pick scope
        const scope = await vscode.window.showQuickPick([
            { label: '$(folder) Workspace', id: 'workspace', description: '.claude/settings.json in workspace root' },
            { label: '$(home) Global', id: 'global', description: '~/.claude/settings.json' },
        ], {
            title: 'Claude Code — Configuration Scope',
            placeHolder: 'Where should the config be saved?'
        });

        if (!scope) { return; }

        // Step 2: Pick model
        const model = await this.pickModel('Claude Code — Select Default Model');
        if (!model) { return; }

        // Step 3: Determine file path
        let settingsPath: string;
        if (scope.id === 'workspace') {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }
            settingsPath = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.json');
        } else {
            settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        }

        // Step 4: Smart merge
        const newEnv = {
            ANTHROPIC_BASE_URL: `http://localhost:${this.port}`,
            ANTHROPIC_AUTH_TOKEN: 'gatex',
            ANTHROPIC_MODEL: model.id
        };

        await this.smartMergeJson(settingsPath, { env: newEnv });

        const relativePath = scope.id === 'workspace'
            ? '.claude/settings.json'
            : '~/.claude/settings.json';

        vscode.window.showInformationMessage(
            `✅ Claude Code configured → ${relativePath}`,
            'Open File'
        ).then(selection => {
            if (selection === 'Open File') {
                vscode.workspace.openTextDocument(settingsPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    // ========================================================================
    // .env File
    // ========================================================================

    private async configureDotEnv(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const model = await this.pickModel('.env — Select Default Model');
        if (!model) { return; }

        const envPath = path.join(workspaceFolder.uri.fsPath, '.env');
        const baseUrl = `http://localhost:${this.port}/v1`;

        const envVars: Record<string, string> = {
            // OpenAI-compatible
            OPENAI_BASE_URL: baseUrl,
            OPENAI_API_KEY: 'gatex',
            OPENAI_MODEL: model.id,
            // Anthropic-compatible
            ANTHROPIC_BASE_URL: `http://localhost:${this.port}`,
            ANTHROPIC_AUTH_TOKEN: 'gatex',
            ANTHROPIC_MODEL: model.id,
        };

        await this.smartMergeEnv(envPath, envVars);

        vscode.window.showInformationMessage(
            '✅ .env file updated with GateX endpoints',
            'Open File'
        ).then(selection => {
            if (selection === 'Open File') {
                vscode.workspace.openTextDocument(envPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    // ========================================================================
    // Copy to Clipboard
    // ========================================================================

    private async copyEnvVars(): Promise<void> {
        const format = await vscode.window.showQuickPick([
            { label: '$(terminal-bash) Shell (export)', id: 'shell', description: 'For bash/zsh' },
            { label: '$(terminal-powershell) PowerShell ($env:)', id: 'powershell', description: 'For PowerShell' },
        ], {
            title: 'Copy Env Vars — Select Format',
            placeHolder: 'Select shell format'
        });

        if (!format) { return; }

        const model = await this.pickModel('Copy Env Vars — Select Default Model');
        if (!model) { return; }

        const baseUrl = `http://localhost:${this.port}/v1`;
        let text: string;

        if (format.id === 'shell') {
            text = [
                `export OPENAI_BASE_URL="${baseUrl}"`,
                `export OPENAI_API_KEY="gatex"`,
                `export OPENAI_MODEL="${model.id}"`,
                `export ANTHROPIC_BASE_URL="http://localhost:${this.port}"`,
                `export ANTHROPIC_AUTH_TOKEN="gatex"`,
                `export ANTHROPIC_MODEL="${model.id}"`,
            ].join('\n');
        } else {
            text = [
                `$env:OPENAI_BASE_URL = "${baseUrl}"`,
                `$env:OPENAI_API_KEY = "gatex"`,
                `$env:OPENAI_MODEL = "${model.id}"`,
                `$env:ANTHROPIC_BASE_URL = "http://localhost:${this.port}"`,
                `$env:ANTHROPIC_AUTH_TOKEN = "gatex"`,
                `$env:ANTHROPIC_MODEL = "${model.id}"`,
            ].join('\n');
        }

        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('✅ Environment variables copied to clipboard');
    }

    // ========================================================================
    // Model Picker
    // ========================================================================

    private async pickModel(title: string): Promise<ModelInfo | undefined> {
        const models = await this.modelManager.getModels();

        if (models.length === 0) {
            vscode.window.showWarningMessage('No models available. Is Copilot signed in?');
            return undefined;
        }

        const items = models.map(m => ({
            label: m.name,
            description: `${m.vendor} · ${m.family}`,
            detail: m.id,
            model: m
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: 'Select a model',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.model;
    }

    // ========================================================================
    // Smart Merge Utilities
    // ========================================================================

    /**
     * Smart merge into a JSON file — only update specified keys,
     * preserve everything else. Creates file if it doesn't exist.
     */
    private async smartMergeJson(filePath: string, updates: Record<string, any>): Promise<void> {
        let existing: Record<string, any> = {};

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            existing = JSON.parse(content);
        } catch {
            // File doesn't exist or invalid JSON — start fresh
        }

        // Deep merge: only update keys in `updates`, keep everything else
        for (const [key, value] of Object.entries(updates)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                existing[key] = { ...(existing[key] || {}), ...value };
            } else {
                existing[key] = value;
            }
        }

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    }

    /**
     * Smart merge into a .env file — only update specified keys,
     * preserve everything else (including comments).
     */
    private async smartMergeEnv(filePath: string, updates: Record<string, string>): Promise<void> {
        let lines: string[] = [];
        const updatedKeys = new Set<string>();

        // Read existing file
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            lines = content.split('\n');
        } catch {
            // File doesn't exist — start fresh
        }

        // Update existing lines
        lines = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed.includes('=')) {
                return line; // Preserve comments and empty lines
            }

            const eqIndex = trimmed.indexOf('=');
            const key = trimmed.substring(0, eqIndex).trim();

            if (key in updates) {
                updatedKeys.add(key);
                return `${key}=${updates[key]}`;
            }
            return line;
        });

        // Append new keys that weren't already in the file
        const newKeys = Object.keys(updates).filter(k => !updatedKeys.has(k));
        if (newKeys.length > 0) {
            // Add a blank separator if file isn't empty
            if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                lines.push('');
            }
            lines.push('# GateX API Endpoints');
            for (const key of newKeys) {
                lines.push(`${key}=${updates[key]}`);
            }
        }

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    }
}
