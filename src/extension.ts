/**
 * GateX - Your gateway to AI models
 * 
 * Main extension entry point (v2 - lean edition)
 */

import * as vscode from 'vscode';
import { GateXServer } from './server';
import { ModelManager } from './models';
import { StatusBarManager } from './statusBar';
import { ConfigGenerator } from './configGenerator';

let server: GateXServer | null = null;
let modelManager: ModelManager | null = null;
let statusBarManager: StatusBarManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 GateX is activating...');

    // Initialize components
    modelManager = new ModelManager();
    statusBarManager = new StatusBarManager();
    server = new GateXServer(modelManager);

    // Start server
    try {
        const port = await server.start();
        statusBarManager.updateStatus('running', port, await modelManager.getModelCount());

        vscode.window.showInformationMessage(
            `⚡ GateX is running on port ${port}`,
            'Copy Endpoint',
            'Configure IDE'
        ).then(selection => {
            if (selection === 'Copy Endpoint') {
                vscode.env.clipboard.writeText(`http://localhost:${port}/v1`);
                vscode.window.showInformationMessage('Endpoint copied to clipboard!');
            } else if (selection === 'Configure IDE') {
                vscode.commands.executeCommand('gatex.configureForIDE');
            }
        });
    } catch (error) {
        statusBarManager.updateStatus('error');
        vscode.window.showErrorMessage(`GateX failed to start: ${error}`);
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('gatex.showInfo', () => showInfo()),
        vscode.commands.registerCommand('gatex.copyEndpoint', () => copyEndpoint()),
        vscode.commands.registerCommand('gatex.healthCheck', () => healthCheck()),
        vscode.commands.registerCommand('gatex.restart', () => restartServer()),
        vscode.commands.registerCommand('gatex.configureForIDE', () => configureForIDE()),
    );

    // Listen for model changes
    context.subscriptions.push(
        vscode.lm.onDidChangeChatModels(async () => {
            const count = await modelManager!.getModelCount();
            statusBarManager!.updateModelCount(count);
        })
    );

    context.subscriptions.push(statusBarManager);

    console.log('✅ GateX activated successfully');
}

export function deactivate() {
    if (server) {
        server.stop();
    }
    console.log('👋 GateX deactivated');
}

// ============================================================================
// Commands
// ============================================================================

async function showInfo() {
    if (!server || !modelManager) {
        vscode.window.showErrorMessage('GateX is not running');
        return;
    }

    const port = server.getPort();
    const models = await modelManager.getModels();
    const endpoint = `http://localhost:${port}/v1`;

    const modelList = models.map(m => `  • ${m.name} (${m.vendor})`).join('\n');

    const selection = await vscode.window.showQuickPick([
        { label: '$(copy) Copy Endpoint URL', id: 'copy-endpoint', description: endpoint },
        { label: '$(settings-gear) Configure for IDE', id: 'configure', description: 'Claude Code, .env, etc.' },
        { label: '$(pulse) Check Model Health', id: 'health', description: `${models.length} models available` },
        { label: '$(refresh) Restart Server', id: 'restart', description: `Port ${port}` },
    ], {
        title: `⚡ GateX — ${endpoint}`,
        placeHolder: 'Select an action'
    });

    if (!selection) { return; }

    switch (selection.id) {
        case 'copy-endpoint':
            await vscode.env.clipboard.writeText(endpoint);
            vscode.window.showInformationMessage(`Copied: ${endpoint}`);
            break;
        case 'configure':
            await configureForIDE();
            break;
        case 'health':
            await healthCheck();
            break;
        case 'restart':
            await restartServer();
            break;
    }
}

async function copyEndpoint() {
    if (!server) {
        vscode.window.showErrorMessage('GateX is not running');
        return;
    }

    const endpoint = `http://localhost:${server.getPort()}/v1`;
    await vscode.env.clipboard.writeText(endpoint);
    vscode.window.showInformationMessage(`Copied: ${endpoint}`);
}

async function healthCheck() {
    if (!modelManager) {
        vscode.window.showErrorMessage('GateX is not running');
        return;
    }

    const output = vscode.window.createOutputChannel('GateX Health Check');
    output.show();
    output.appendLine('🔍 Checking model health...\n');

    const results = await modelManager.healthCheck((model, status, latency) => {
        if (status === 'healthy') {
            output.appendLine(`✅ ${model.name} | ${latency}ms`);
        } else {
            output.appendLine(`❌ ${model.name} | ${status}`);
        }
    });

    output.appendLine('\n' + '='.repeat(50));
    output.appendLine(`Total: ${results.healthy}/${results.total} healthy`);
}

async function restartServer() {
    if (server) {
        server.stop();
    }

    try {
        const port = await server!.start();
        statusBarManager!.updateStatus('running', port);
        vscode.window.showInformationMessage(`GateX restarted on port ${port}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to restart: ${error}`);
    }
}

async function configureForIDE() {
    if (!server || !modelManager) {
        vscode.window.showErrorMessage('GateX is not running');
        return;
    }

    const generator = new ConfigGenerator(server.getPort(), modelManager);
    await generator.run();
}
