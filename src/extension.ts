// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { handleChatRequest } from './chatHandler';

export function activate(context: vscode.ExtensionContext) {

	let disposableCommand = vscode.commands.registerCommand('myCompilerExtension.runTerminalCommand', (args: { command: string }) => {
        if (!args || !args.command) {
            return;
        }

        let terminal = vscode.window.activeTerminal;
        if (!terminal) {
            terminal = vscode.window.createTerminal('Agent Compiler');
        }

        terminal.show(true);
        terminal.sendText(args.command); // This executes whatever argument is passed to it
    });
	context.subscriptions.push(disposableCommand);
	
	const outputChannel = vscode.window.createOutputChannel('Sub Agent Manager');
	context.subscriptions.push(outputChannel);

	const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        await handleChatRequest(request, context, stream, token, outputChannel);
    });
	
	context.subscriptions.push(agent);
}

export function deactivate() {}
