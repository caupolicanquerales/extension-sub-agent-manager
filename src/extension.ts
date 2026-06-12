// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { handleChatRequest } from './chatHandler';

export function activate(context: vscode.ExtensionContext) {

	const outputChannel = vscode.window.createOutputChannel('Sub Agent Manager');
	context.subscriptions.push(outputChannel);

	const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        // Add any pre-processing steps here before calling the agent

        await handleChatRequest(request, context, stream, token, outputChannel);
    });
	
	context.subscriptions.push(agent);
}

export function deactivate() {}
