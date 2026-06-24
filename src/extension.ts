// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { handleChatRequest } from './chatHandler';
import { Step } from './interfaces';

export function activate(context: vscode.ExtensionContext) {

	let disposableCommand = vscode.commands.registerCommand('myCompilerExtension.runTerminalCommand', (args: { command: string }) => {
        if (!args || !args.command) {
            return;
        }

        let terminal = vscode.window.activeTerminal;
        if (!terminal || terminal.name !== 'Agent Compiler') {
            const existingTerminal = vscode.window.terminals.find(t => t.name === 'Agent Compiler');
            terminal = existingTerminal || vscode.window.createTerminal('Agent Compiler');
        }

        terminal.show(true);
        terminal.sendText(args.command); // This executes whatever argument is passed to it
    });
	context.subscriptions.push(disposableCommand);

    const executionBuffers = new Map<vscode.TerminalShellExecution, string[]>();

    const startListener = vscode.window.onDidStartTerminalShellExecution((event) => {
        if (event.terminal.name !== 'Agent Compiler') {
            return;
        }
        const chunks: string[] = [];
        executionBuffers.set(event.execution, chunks);
        (async () => {
            for await (const chunk of event.execution.read()) {
                chunks.push(chunk);
            }
        })();
    });
    context.subscriptions.push(startListener);

    const executionListener = vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.terminal.name !== 'Agent Compiler') {
            return;
        }

        const exitCode = event.exitCode;
        const commandLine = event.execution.commandLine;
        if (exitCode !== 0 && exitCode !== undefined) {
            const chunks = executionBuffers.get(event.execution) ?? [];
            const logs = stripAnsiCodes(chunks.join(''));
            sendErrorToAgent(commandLine.value, exitCode, logs);
        }
        executionBuffers.delete(event.execution);
    });
    context.subscriptions.push(executionListener);

    const applyStepCommand = vscode.commands.registerCommand(
        'manager-extension.applyResolutionStep', 
        async (step: Step) => {
            if (step.type === 'command') {
                // Execute the command directly in the integrated terminal
                const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Agent Fixes');
                terminal.show();
                terminal.sendText(step.payload?.command || '');
            } else if (step.type === 'file_edit') {
                // Example: Write content or notify user
                vscode.window.showInformationMessage(`Applying path fix for step ${step.id}...`);
                // Implement your file manipulation or workspace edit here
            }
        }
    );
    context.subscriptions.push(applyStepCommand);
	
	const outputChannel = vscode.window.createOutputChannel('Sub Agent Manager');
	context.subscriptions.push(outputChannel);

	const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        await handleChatRequest(request, context, stream, token, outputChannel);
    });
	
	context.subscriptions.push(agent);
}

function stripAnsiCodes(str: string): string {
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    return str.replace(ansiRegex, '');
}

function sendErrorToAgent(command: string, exitCode: number, logs: string) {
    const errorMessage =
        `[INPUT_ERROR: LOGS] An error occurred while executing the command.\n\n` +
        `**Command:** \`${command}\`\n` +
        `**Exit Code:** ${exitCode}\n` +
        `**Logs:**\n\`\`\`text\n${logs}\n\`\`\`\n\n` +
        `Please analyze this error and provide a fix.`;

    vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@sub-agent-manager ${errorMessage}`,
        isPartialQuery: false
    });
}

