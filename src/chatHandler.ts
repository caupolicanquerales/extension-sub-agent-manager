import * as vscode from 'vscode';
import { ToolArgument } from './interfaces/interfaces';
import { sendChatPayload } from './methods/sendingChatPayload';
import { processFixDefectSteps } from './methods/handlingFixDefect';
import { OriginalContentProvider, PatchCodeLensProvider } from './methods/applyingContentFile';
import { displayBoxCommand } from './elements/boxToDisplayCommand';
import { extractPomMetadata } from './methods/extractingMetadata';


function renderLabeledItems(
    stream: vscode.ChatResponseStream,
    items: Array<{ id?: string; title?: string; description?: string }>
): void {
    for (const item of items) {
        const label = [item.id ? `Step ${item.id}` : '', item.title].filter(Boolean).join(': ');
        stream.markdown(`**${label}**\n`);
        if (item.description) {
            stream.markdown(`${item.description}\n\n`);
        }
    }
}

export async function handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    outputChannel: vscode.OutputChannel,
    pendingStepsStore: Map<string, any[]>,
    pendingFixResolvers: Map<string, () => void>,
    originalContentProvider: OriginalContentProvider,
    patchCodeLensProvider: PatchCodeLensProvider,
    conversationId: string
): Promise<void> {
    stream.progress('Thinking...');

    try {
        let currentPayload: any = {
            prompt: request.prompt,
            conversationId: conversationId
        };

        let processing = true;
        const MAX_TOOL_ITERATIONS = 10;
        let iterations = 0;

        while (processing && !token.isCancellationRequested) {
            if (++iterations > MAX_TOOL_ITERATIONS) {
                stream.markdown('⚠️ **Max tool iterations reached. Stopping.**');
                break;
            }

            const result = await sendChatPayload(currentPayload, stream, token, outputChannel);

            if (result.dataMessage?.type === 'recursive' && result.dataMessage.toolCall) {
                const toolName = result.dataMessage.toolCall.name;
                outputChannel.appendLine(`[Agent Loop] Executing tool: ${toolName}`);
                
                let toolResult = '';
                if (toolName === 'getProjectMetadata') {
                    const args: ToolArgument = (result.dataMessage.toolCall.arguments && result.dataMessage.toolCall.arguments[0]) || {};
                    stream.progress(`Scanning layout for ${args.projectName || 'project'}...`);
                    toolResult = await executeWorkspaceScan(args.projectName, args.actionOverProject, outputChannel);
                } else {
                    toolResult = `Error: Tool ${toolName} is not implemented in this extension-sub-agent-manager extension.`;
                }
                
                currentPayload = {
                    conversationId: conversationId,
                    prompt: toolResult
                };
                
                stream.progress('Processing tool data...');
            } else if (result.dataMessage?.type === 'terminal') {

                displayBoxCommand(result.dataMessage, stream);   
  
                processing = false;

            } else if (result.dataMessage?.type === 'step_actions') {
                const stepPlan = result.dataMessage.stepPlanError;
                const defectPlan = result.dataMessage.defects;

                if (stepPlan?.errorSummary) {
                    stream.markdown(`### Error Analysis\n${stepPlan.errorSummary}\n\n`);
                }

                if (stepPlan?.steps && stepPlan.steps.length > 0) {
                    stream.markdown(`**Suggested fix steps:**\n\n`);
                    renderLabeledItems(stream, stepPlan.steps);
                    const stepsId = crypto.randomUUID();
                    pendingStepsStore.set(stepsId, stepPlan.steps);
                    const encodedArgs = encodeURIComponent(JSON.stringify([stepsId]));
                    const buttonMd = new vscode.MarkdownString(
                        `[$(wrench) Apply All Steps](command:manager-extension.applyResolutionStep?${encodedArgs})`,
                        true
                    );
                    buttonMd.isTrusted = { enabledCommands: ['manager-extension.applyResolutionStep'] };
                    stream.markdown(buttonMd);
                }

                if (defectPlan?.defects && defectPlan.defects.length > 0) {
                    stream.markdown(`### Defects Found (${defectPlan.totalDefectsFound ?? defectPlan.defects.length})\n\n`);
                    renderLabeledItems(stream, defectPlan.defects);
                    const stepsId = crypto.randomUUID();
                    pendingStepsStore.set(stepsId, defectPlan?.defects);
                    const encodedArgs = encodeURIComponent(JSON.stringify([stepsId]));
                    const buttonMd = new vscode.MarkdownString(
                        `[$(wrench) Apply All Steps](command:manager-extension.fixDefect?${encodedArgs})`,
                        true
                    );
                    buttonMd.isTrusted = { enabledCommands: ['manager-extension.fixDefect'] };
                    stream.markdown(buttonMd);

                    processing = false;
                    const fixTrigger = new Promise<void>((resolve, reject) => {
                        pendingFixResolvers.set(stepsId, resolve);
                        const d = token.onCancellationRequested(() => {
                            pendingFixResolvers.delete(stepsId);
                            d.dispose();
                            reject(new vscode.CancellationError());
                        });
                    });
                    stream.progress('Click "Apply All Steps" to begin fixing…');
                    try {
                        await fixTrigger;
                    } catch (e) {
                        if (e instanceof vscode.CancellationError) { return; }
                        throw e;
                    }
                    await processFixDefectSteps(
                        stepsId, outputChannel, pendingStepsStore,
                        originalContentProvider, patchCodeLensProvider, conversationId, stream
                    );
                    return;
                }

                processing = false;

            } else {
                processing = false;
            }
        }

    } catch (err) {
        stream.markdown(`❌ **Error:** ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function executeWorkspaceScan(targetProjectName: string | undefined, action: string | undefined, outputChannel: vscode.OutputChannel): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;

    if (!folders || folders.length === 0) {
        return JSON.stringify({ status: 'ERROR', reason: 'No workspace folders are currently open.' });
    }

    let targetFolder = folders[0];

    if (targetProjectName) {
        const cleanedName = targetProjectName.toLowerCase().trim();
        const found = folders.find(f => f.name.toLowerCase().includes(cleanedName));
        if (found) {
            targetFolder = found;
        } else {
            return JSON.stringify({
                status: 'ERROR',
                reason: `No folder matching "${targetProjectName}" found.`,
                availableFolders: folders.map(f => f.name)
            });
        }
    }

    outputChannel.appendLine(`[Workspace Scan] Scanning folder: ${targetFolder.name}`);

    const mavenFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(targetFolder, '**/pom.xml'), '**/target/**', 1);
    const npmFiles   = await vscode.workspace.findFiles(new vscode.RelativePattern(targetFolder, '**/package.json'), '**/node_modules/**', 1);

    if (mavenFiles.length > 0) {
        const metadata = await extractPomMetadata(mavenFiles[0]);
        return JSON.stringify({
            status: 'OK',
            project: targetFolder.name,
            buildTool: 'maven',
            buildFile: mavenFiles[0].fsPath,
            metadata: metadata,
            action: action
        });
    }

    if (npmFiles.length > 0) {
        return JSON.stringify({
            status: 'OK',
            project: targetFolder.name,
            buildTool: 'npm',
            buildFile: npmFiles[0].fsPath,
            action: action
        });
    }

    return JSON.stringify({
        status: 'OK',
        project: targetFolder.name,
        buildTool: 'unknown',
        buildFile: null,
        action: action
    });
}
