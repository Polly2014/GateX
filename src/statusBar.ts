/**
 * GateX Status Bar Manager
 * 
 * Manages the status bar item
 */

import * as vscode from 'vscode';

type ServerStatus = 'starting' | 'running' | 'error' | 'stopped';

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private port: number = 0;
    private modelCount: number = 0;
    private status: ServerStatus = 'starting';

    constructor() {
        // 改为左对齐，优先级 0 让它靠左显示
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            0
        );
        this.statusBarItem.command = 'gatex.showInfo';
        this.statusBarItem.show();
        this.updateDisplay();
    }

    updateStatus(status: ServerStatus, port?: number, modelCount?: number): void {
        this.status = status;
        if (port !== undefined) {
            this.port = port;
        }
        if (modelCount !== undefined) {
            this.modelCount = modelCount;
        }
        this.updateDisplay();
    }

    updateModelCount(count: number): void {
        this.modelCount = count;
        this.updateDisplay();
    }

    private updateDisplay(): void {
        switch (this.status) {
            case 'starting':
                this.statusBarItem.text = '$(loading~spin) GateX...';
                this.statusBarItem.tooltip = 'GateX is starting...';
                this.statusBarItem.backgroundColor = undefined;
                break;
            
            case 'running':
                this.statusBarItem.text = `$(zap) GateX :${this.port}`;
                this.statusBarItem.tooltip = new vscode.MarkdownString(
                    `**⚡ GateX is running**\n\n` +
                    `- **Endpoint:** http://localhost:${this.port}/v1\n` +
                    `- **Models:** ${this.modelCount}\n\n` +
                    `Click for actions`
                );
                this.statusBarItem.backgroundColor = undefined;
                break;
            
            case 'error':
                this.statusBarItem.text = '$(error) GateX';
                this.statusBarItem.tooltip = 'GateX encountered an error. Click to retry.';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            
            case 'stopped':
                this.statusBarItem.text = '$(circle-slash) GateX';
                this.statusBarItem.tooltip = 'GateX is stopped. Click to start.';
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
