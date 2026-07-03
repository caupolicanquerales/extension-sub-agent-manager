// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleChatRequest } from './chatHandler';
import { executeCommandStep } from './methods/handlingTerminalCommands';
import {  OriginalContentProvider, PatchCodeLensProvider } from './methods/applyingContentFile';
import { stripAnsiCodes, sendErrorToAgent } from './methods/handlingErrorLogs';
import { processFixDefectSteps } from './methods/handlingFixDefect';
import { processRunProjectCommand } from './methods/handlingRunProjectCommand';

export function activate(context: vscode.ExtensionContext) {

    const sessionConversationId = crypto.randomUUID();
	const originalContentProvider = new OriginalContentProvider();
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(
			OriginalContentProvider.scheme,
			originalContentProvider
		)
	);

	const patchCodeLensProvider = new PatchCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, patchCodeLensProvider)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('manager-extension.keepPatch', (uriStr: string) => {
			patchCodeLensProvider.decide(uriStr, 'keep');
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('manager-extension.undoPatch', (uriStr: string) => {
			patchCodeLensProvider.decide(uriStr, 'undo');
		})
	);

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

    const pendingStepsStore = new Map<string, any[]>();
    const pendingFixResolvers = new Map<string, () => void>();

	const outputChannel = vscode.window.createOutputChannel('Sub Agent Manager');
	context.subscriptions.push(outputChannel);

    const applyStepsDisposable = vscode.commands.registerCommand(
        'manager-extension.applyResolutionStep',
        async (stepsId: string) => {
            const steps = pendingStepsStore.get(stepsId);
            if (!steps) {
                vscode.window.showErrorMessage("Resolution steps not found or already applied.");
                return;
            }
            pendingStepsStore.delete(stepsId);
            // Tracks the FIRST content of each file before any step touches it.
            // Used to show a single accurate diff per file after all steps finish.
            const originalSnapshots = new Map<string, string>();

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Executing Resolution Plan",
                cancellable: false
            }, async (progress) => {
                
                for (let i = 0; i < steps.length; i++) {
                    const step = steps[i];
                    const stepLabel = `Step ${i + 1}/${steps.length}: ${step.title}`;
                    
                    progress.report({ message: stepLabel });

                    try {
                        if (step.type === 'command') {
                            await executeCommandStep(step);
                        }
                    } catch (error) {
                        const errorDetail = error instanceof Error ? error.message : String(error);
                        outputChannel.appendLine(`\n❌ Failed at step "${step.title}":\n${errorDetail}`);
                        outputChannel.show(true);
                        vscode.window.showErrorMessage(`❌ Failed at "${step.title}". See "Sub Agent Manager" output for details.`);
                        return; 
                    }
                }

                vscode.window.showInformationMessage("🎉 All resolution steps applied successfully!");
            });

            // Diff + Keep/Undo MUST run outside withProgress — the progress
            // notification occupies the notification slot and prevents
            // showInformationMessage buttons from appearing.
            for (const [fsPath, originalContent] of originalSnapshots) {
                const fileName = path.basename(fsPath);
                const tempPath = path.join(os.tmpdir(), `agent-original-${Date.now()}-${fileName}`);
                fs.writeFileSync(tempPath, originalContent, 'utf8');

                await vscode.commands.executeCommand(
                    'vscode.diff',
                    vscode.Uri.file(tempPath),
                    vscode.Uri.file(fsPath),
                    `Agent Fix: ${fileName} (original ↔ modified)`
                );

                const choice = await vscode.window.showInformationMessage(
                    `Agent applied changes to ${fileName}. Keep or undo?`,
                    { modal: true },
                    'Keep Changes',
                    'Undo Changes'
                );

                if (choice === 'Undo Changes') {
                    fs.writeFileSync(fsPath, originalContent, 'utf8');
                    const doc = await vscode.workspace.openTextDocument(fsPath);
                    await doc.save();
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
                    vscode.window.showInformationMessage(`↩️ Reverted changes to ${fileName}.`);
                } else {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
            }
        }
    );
    context.subscriptions.push(applyStepsDisposable);

    let fixCommand = vscode.commands.registerCommand('manager-extension.fixDefect', async (stepsId: string) => {
        const resolve = pendingFixResolvers.get(stepsId);
        if (resolve) {
            pendingFixResolvers.delete(stepsId);
            resolve();
        } else {
            try {
                await processFixDefectSteps(stepsId, outputChannel, pendingStepsStore, originalContentProvider, patchCodeLensProvider, sessionConversationId);
            } catch (err) {
                outputChannel.appendLine(`❌ Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
                vscode.window.showErrorMessage(`Sub Agent error: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    });

    context.subscriptions.push(fixCommand);

    let runProjectCommand = vscode.commands.registerCommand('manager-extension.runProjectCommand', async () => {
        try {
            await processRunProjectCommand(outputChannel, sessionConversationId);
        } catch (err) {
            outputChannel.appendLine(`❌ Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
            vscode.window.showErrorMessage(`Sub Agent error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    context.subscriptions.push(runProjectCommand);

	const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        await handleChatRequest(request, context, stream, token, outputChannel, pendingStepsStore, pendingFixResolvers, originalContentProvider, patchCodeLensProvider, sessionConversationId);
    });
	
	context.subscriptions.push(agent);
}

