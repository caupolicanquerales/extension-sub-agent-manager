import * as vscode from 'vscode';
import { sendChatPayload } from './sendingChatPayload';
import { displayBoxCommand } from '../elements/boxToDisplayCommand';


export async function processRunProjectCommand(
    outputChannel: vscode.OutputChannel,
    conversationId: string,
    stream?: vscode.ChatResponseStream
) {
        outputChannel.show(true);
        outputChannel.appendLine('');
        outputChannel.appendLine(`${'─'.repeat(60)}`);
        outputChannel.appendLine(`▶  Sub Agent — retrieving terminal command   ${new Date().toLocaleTimeString()}`);
        outputChannel.appendLine(`${'─'.repeat(60)}`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Sub Agent: retrieving terminal command…',
            cancellable: false
        }, async (progress) => {

                const retrievingMsg = `Retrieving terminal command…`;
                stream?.progress(retrievingMsg);
                progress.report({ message: retrievingMsg });
                outputChannel.appendLine(`\n📂  Retrieving terminal command from sub agent…`);

                const currentPayload: any = {
                    prompt: "resend the terminal command",
                    conversationId: conversationId
                };

                const result = await sendChatPayload(currentPayload, undefined, undefined, outputChannel);

                if (result?.dataMessage) {
                    outputChannel.appendLine(`✓  Command retrieved successfully`);
                    if (stream) {
                        displayBoxCommand(result.dataMessage, stream);
                    } else {
                        const command = result.dataMessage.message ?? '';
                        outputChannel.appendLine(`Command: ${command}`);
                        const choice = await vscode.window.showInformationMessage(
                            `Terminal command: ${command}`,
                            'Run Command'
                        );
                        if (choice === 'Run Command') {
                            await vscode.commands.executeCommand(
                                'myCompilerExtension.runTerminalCommand',
                                { command }
                            );
                        }
                    }
                } else {
                    outputChannel.appendLine(`✗  No command returned by sub agent`);
                    stream?.markdown(`\n> ⚠ No terminal command was returned by the sub agent.\n`);
                    if (!stream) {
                        vscode.window.showWarningMessage('No terminal command was returned by the sub agent.');
                    }
                }
        });
}
