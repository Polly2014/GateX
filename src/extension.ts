/**
 * GateX - Your gateway to AI models
 * 
 * Main extension entry point
 */

import * as vscode from 'vscode';
import { GateXServer } from './server';
import { ModelManager } from './models';
import { StatusBarManager } from './statusBar';
import { Dashboard } from './dashboard';

let server: GateXServer | null = null;
let modelManager: ModelManager | null = null;
let statusBarManager: StatusBarManager | null = null;
let dashboard: Dashboard | null = null;

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
            'Copy Endpoint'
        ).then(selection => {
            if (selection === 'Copy Endpoint') {
                vscode.env.clipboard.writeText(`http://localhost:${port}/v1`);
                vscode.window.showInformationMessage('Endpoint copied to clipboard!');
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
        vscode.commands.registerCommand('gatex.copyCode', () => copyCode()),
        vscode.commands.registerCommand('gatex.healthCheck', () => healthCheck()),
        vscode.commands.registerCommand('gatex.restart', () => restartServer()),
        vscode.commands.registerCommand('gatex.openDashboard', () => openDashboard()),
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
    // 直接打开 Dashboard
    await openDashboard();
}

async function openDashboard() {
    if (!server || !modelManager) {
        vscode.window.showErrorMessage('GateX is not running');
        return;
    }

    if (!dashboard) {
        dashboard = new Dashboard(modelManager, server.getPort());
    }
    
    await dashboard.show();
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

async function copyCode() {
    if (!server) {
        vscode.window.showErrorMessage('GateX is not running');
        return;
    }
    
    const port = server.getPort();
    const code = `from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:${port}/v1",
    api_key="gatex"  # Any value works
)

response = client.chat.completions.create(
    model="claude-sonnet-4",  # Or: gpt-4o, gpt-4o-mini, etc.
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)`;

    await vscode.env.clipboard.writeText(code);
    vscode.window.showInformationMessage('Python code copied to clipboard!');
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
