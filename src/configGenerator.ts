/**
 * GateX Config Generator v2
 * 
 * Generate IDE configurations for connecting to GateX.
 * 
 * Supported targets:
 * - Claude Code  (.claude/settings.json + onboarding bypass)
 * - Codex CLI    (~/.codex/config.toml)
 * - .env File    (OpenAI + Anthropic vars)
 * - Clipboard    (bash/PowerShell export commands)
 * 
 * Learned from Agent Maestro — improved with:
 * - Dual model picker for Claude (main + fast)
 * - Claude onboarding bypass (config.json + .claude.json)
 * - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
 * - Codex CLI native TOML config
 * - Model picker with family grouping + ⭐ recommendations
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelManager, ModelInfo } from './models';

// ============================================================================
// Types
// ============================================================================

interface QuickPickModelItem extends vscode.QuickPickItem {
    model?: ModelInfo;
}

type ModelFamily = 'claude' | 'gpt' | 'gemini' | 'other';

// ============================================================================
// Config Generator
// ============================================================================

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
        const selected = await vscode.window.showQuickPick([
            { label: '$(file-code) Claude Code', id: 'claude-code', description: '.claude/settings.json + onboarding setup' },
            { label: '$(terminal) Codex CLI', id: 'codex', description: '~/.codex/config.toml' },
            { label: '$(file) .env File', id: 'dotenv', description: 'Generate .env with API endpoints' },
            { label: '$(clippy) Copy Env Vars', id: 'clipboard', description: 'Copy export commands to clipboard' },
        ], {
            title: '⚡ GateX — Configure for IDE',
            placeHolder: 'Select target configuration'
        });

        if (!selected) { return; }

        switch (selected.id) {
            case 'claude-code': await this.configureClaudeCode(); break;
            case 'codex':       await this.configureCodex(); break;
            case 'dotenv':      await this.configureDotEnv(); break;
            case 'clipboard':   await this.copyEnvVars(); break;
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

        // Step 2: Pick main model (recommend Claude family)
        const mainModel = await this.pickModel(
            'Claude Code — Main Model',
            'claude',
            'Select the primary model for Claude Code'
        );
        if (!mainModel) { return; }

        // Step 3: Pick fast model (for quick tasks)
        const fastModel = await this.pickModel(
            'Claude Code — Fast Model (for quick tasks)',
            'claude',
            'Select a smaller/faster model for quick operations',
            ['haiku', 'mini', 'fast', 'gpt-4o-mini']
        );
        if (!fastModel) { return; }

        // Step 4: Determine settings.json path
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

        // Step 5: Write settings.json with smart merge
        const newEnv: Record<string, string> = {
            ANTHROPIC_BASE_URL: `http://localhost:${this.port}`,
            ANTHROPIC_AUTH_TOKEN: 'gatex',
            ANTHROPIC_MODEL: mainModel.id,
            ANTHROPIC_SMALL_FAST_MODEL: fastModel.id,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        };

        await this.smartMergeJson(settingsPath, { env: newEnv });

        // Step 6: Ensure Claude Code onboarding bypass (global only)
        if (scope.id === 'global') {
            await this.ensureClaudeOnboarding();
        }

        const relativePath = scope.id === 'workspace'
            ? '.claude/settings.json'
            : '~/.claude/settings.json';

        vscode.window.showInformationMessage(
            `✅ Claude Code configured → ${relativePath} (main: ${mainModel.name}, fast: ${fastModel.name})`,
            'Open File'
        ).then(selection => {
            if (selection === 'Open File') {
                vscode.workspace.openTextDocument(settingsPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    /**
     * Ensure Claude Code can start without manual onboarding.
     * Creates ~/.claude/config.json and ~/.claude.json if not present.
     */
    private async ensureClaudeOnboarding(): Promise<void> {
        // ~/.claude/config.json — needs primaryApiKey
        const configPath = path.join(os.homedir(), '.claude', 'config.json');
        try {
            const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (!existing.primaryApiKey) {
                existing.primaryApiKey = 'GateX';
                this.writeJsonFile(configPath, existing);
            }
        } catch {
            // File doesn't exist — create it
            this.writeJsonFile(configPath, { primaryApiKey: 'GateX' });
        }

        // ~/.claude.json — onboarding completion flag
        const onboardingPath = path.join(os.homedir(), '.claude.json');
        try {
            const existing = JSON.parse(fs.readFileSync(onboardingPath, 'utf-8'));
            if (!existing.hasCompletedOnboarding) {
                existing.hasCompletedOnboarding = true;
                this.writeJsonFile(onboardingPath, existing);
            }
        } catch {
            this.writeJsonFile(onboardingPath, { hasCompletedOnboarding: true });
        }
    }

    // ========================================================================
    // Codex CLI Configuration
    // ========================================================================

    private async configureCodex(): Promise<void> {
        // Pick model (recommend GPT/OpenAI family)
        const model = await this.pickModel(
            'Codex CLI — Select Model',
            'gpt',
            'Select the model for Codex CLI'
        );
        if (!model) { return; }

        const configPath = path.join(os.homedir(), '.codex', 'config.toml');

        // Read existing TOML (preserve other settings)
        let existingContent = '';
        try {
            existingContent = fs.readFileSync(configPath, 'utf-8');
        } catch {
            // File doesn't exist
        }

        // Smart merge TOML: update GateX provider, preserve the rest
        const newContent = this.mergeCodexToml(existingContent, model);

        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(configPath, newContent, 'utf-8');

        vscode.window.showInformationMessage(
            `✅ Codex CLI configured → ~/.codex/config.toml (model: ${model.name})`,
            'Open File'
        ).then(selection => {
            if (selection === 'Open File') {
                vscode.workspace.openTextDocument(configPath).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    /**
     * Generate/merge Codex CLI TOML config.
     * Simple TOML generation (no dependency needed for this structure).
     */
    private mergeCodexToml(existing: string, model: ModelInfo): string {
        const lines = existing.split('\n');
        const gatexSection = [
            `[model_providers.gatex]`,
            `name = "GateX"`,
            `base_url = "http://localhost:${this.port}/v1"`,
            `wire_api = "chat"`,
        ];

        // Check if GateX provider already exists
        const gatexSectionStart = lines.findIndex(l => l.trim() === '[model_providers.gatex]');

        if (gatexSectionStart !== -1) {
            // Replace existing GateX section (until next section or EOF)
            let sectionEnd = lines.length;
            for (let i = gatexSectionStart + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith('[') && !lines[i].trim().startsWith('[model_providers.gatex]')) {
                    sectionEnd = i;
                    break;
                }
            }
            lines.splice(gatexSectionStart, sectionEnd - gatexSectionStart, ...gatexSection);
        } else if (existing.trim()) {
            // Append to existing file
            lines.push('', ...gatexSection);
        } else {
            // Fresh file
            lines.length = 0;
            lines.push(...gatexSection);
        }

        // Update top-level model and model_provider
        const updatedLines = this.upsertTomlKey(lines, 'model', `"${model.id}"`);
        const finalLines = this.upsertTomlKey(updatedLines, 'model_provider', '"gatex"');

        return finalLines.join('\n') + '\n';
    }

    /**
     * Insert or update a top-level TOML key (before any [section]).
     */
    private upsertTomlKey(lines: string[], key: string, value: string): string[] {
        const result = [...lines];

        // Find existing key (must be before first [section])
        const firstSection = result.findIndex(l => l.trim().startsWith('['));
        const searchEnd = firstSection === -1 ? result.length : firstSection;

        const existingIdx = result.findIndex((l, i) =>
            i < searchEnd && l.trim().startsWith(`${key} =`) || l.trim().startsWith(`${key}=`)
        );

        if (existingIdx !== -1) {
            result[existingIdx] = `${key} = ${value}`;
        } else {
            // Insert at top (before first section, after any existing top-level keys)
            const insertAt = firstSection === -1 ? 0 : firstSection;
            result.splice(insertAt, 0, `${key} = ${value}`);
        }

        return result;
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

        const model = await this.pickModel(
            '.env — Select Default Model',
            undefined,
            'Select the default model for environment variables'
        );
        if (!model) { return; }

        const envPath = path.join(workspaceFolder.uri.fsPath, '.env');
        const baseUrl = `http://localhost:${this.port}/v1`;

        const envVars: Record<string, string> = {
            OPENAI_BASE_URL: baseUrl,
            OPENAI_API_KEY: 'gatex',
            OPENAI_MODEL: model.id,
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

        const model = await this.pickModel(
            'Copy Env Vars — Select Default Model',
            undefined,
            'Select the default model'
        );
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
    // Model Picker — with family grouping & ⭐ recommendations
    // ========================================================================

    /**
     * Show a grouped model picker with recommendations.
     * 
     * @param title - QuickPick title
     * @param preferFamily - Prioritize this model family (shown first with ⭐)
     * @param placeholder - QuickPick placeholder text
     * @param boostKeywords - Extra keywords to mark as ⭐ Recommended
     */
    private async pickModel(
        title: string,
        preferFamily?: ModelFamily,
        placeholder?: string,
        boostKeywords?: string[]
    ): Promise<ModelInfo | undefined> {
        const models = await this.modelManager.getModels();

        if (models.length === 0) {
            vscode.window.showWarningMessage('No models available. Is Copilot signed in?');
            return undefined;
        }

        // Classify models by family
        const classified = models.map(m => ({
            model: m,
            family: this.classifyFamily(m)
        }));

        // Build QuickPick items with separators
        const items: QuickPickModelItem[] = [];

        // ⭐ Recommended section — preferred family + boost keywords
        if (preferFamily || boostKeywords) {
            const recommended = classified.filter(({ model, family }) => {
                if (preferFamily && family === preferFamily) { return true; }
                if (boostKeywords) {
                    const idLower = model.id.toLowerCase();
                    return boostKeywords.some(kw => idLower.includes(kw.toLowerCase()));
                }
                return false;
            });

            if (recommended.length > 0) {
                items.push({ label: '⭐ Recommended', kind: vscode.QuickPickItemKind.Separator });
                for (const { model } of recommended) {
                    items.push(this.toQuickPickItem(model, true));
                }
            }

            // Other models
            const others = classified.filter(({ model, family }) => {
                if (preferFamily && family === preferFamily) { return false; }
                if (boostKeywords) {
                    const idLower = model.id.toLowerCase();
                    if (boostKeywords.some(kw => idLower.includes(kw.toLowerCase()))) { return false; }
                }
                return true;
            });

            if (others.length > 0) {
                items.push({ label: 'Other Models', kind: vscode.QuickPickItemKind.Separator });
                for (const { model } of others) {
                    items.push(this.toQuickPickItem(model, false));
                }
            }
        } else {
            // No preference — group by family
            const families: [string, ModelFamily][] = [
                ['Claude', 'claude'], ['GPT / OpenAI', 'gpt'],
                ['Gemini', 'gemini'], ['Other', 'other']
            ];
            for (const [label, family] of families) {
                const group = classified.filter(c => c.family === family);
                if (group.length > 0) {
                    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
                    for (const { model } of group) {
                        items.push(this.toQuickPickItem(model, false));
                    }
                }
            }
        }

        const selected = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: placeholder || 'Select a model',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.model;
    }

    private toQuickPickItem(model: ModelInfo, starred: boolean): QuickPickModelItem {
        return {
            label: `${starred ? '$(star-full) ' : ''}${model.name}`,
            description: `${model.vendor} · ${model.family}`,
            detail: model.id,
            model
        };
    }

    private classifyFamily(model: ModelInfo): ModelFamily {
        const id = model.id.toLowerCase();
        const family = model.family.toLowerCase();

        if (id.includes('claude') || family.includes('claude')) { return 'claude'; }
        if (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4') || id.includes('codex') || family.includes('gpt') || family.includes('openai')) { return 'gpt'; }
        if (id.includes('gemini') || family.includes('gemini')) { return 'gemini'; }
        return 'other';
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

        for (const [key, value] of Object.entries(updates)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                existing[key] = { ...(existing[key] || {}), ...value };
            } else {
                existing[key] = value;
            }
        }

        this.writeJsonFile(filePath, existing);
    }

    /**
     * Smart merge into a .env file — only update specified keys,
     * preserve everything else (including comments).
     */
    private async smartMergeEnv(filePath: string, updates: Record<string, string>): Promise<void> {
        let lines: string[] = [];
        const updatedKeys = new Set<string>();

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            lines = content.split('\n');
        } catch {
            // File doesn't exist — start fresh
        }

        lines = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed.includes('=')) {
                return line;
            }

            const eqIndex = trimmed.indexOf('=');
            const key = trimmed.substring(0, eqIndex).trim();

            if (key in updates) {
                updatedKeys.add(key);
                return `${key}=${updates[key]}`;
            }
            return line;
        });

        const newKeys = Object.keys(updates).filter(k => !updatedKeys.has(k));
        if (newKeys.length > 0) {
            if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                lines.push('');
            }
            lines.push('# GateX API Endpoints');
            for (const key of newKeys) {
                lines.push(`${key}=${updates[key]}`);
            }
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    }

    /**
     * Write a JSON file with pretty formatting. Creates parent dirs if needed.
     */
    private writeJsonFile(filePath: string, data: any): void {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    }
}
