import * as vscode from 'vscode';
import * as http from 'http';
import type { IncomingMessage } from 'http';
import { ToolArgument, DataMessage } from './interfaces';



export async function handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const conversationId = crypto.randomUUID(); 
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

            if (result.dataMessage?.type == 'recursive' && result.dataMessage.toolCall) {
                const toolName = result.dataMessage.toolCall.name;
                outputChannel.appendLine(`[Agent Loop] Executing tool: ${toolName}`);
                
                // Handle the tool locally
                let toolResult = '';
                if (toolName === 'getProjectMetadata') {
                    const args: ToolArgument = (result.dataMessage.toolCall.arguments && result.dataMessage.toolCall.arguments[0]) || {};
                    stream.progress(`Scanning layout for ${args.projectName || 'project'}...`);
                    toolResult = await executeWorkspaceScan(args.projectName, args.actionOverProject, outputChannel);
                } else {
                    toolResult = `Error: Tool ${toolName} is not implemented in this extension-sub-agent-manager extension.`;
                }

                // Prepare the next payload to send the tool output back to the agent manager
                currentPayload = {
                    conversationId: conversationId,
                    prompt: toolResult
                };
                
                stream.progress('Processing tool data...');
            } else if (result.dataMessage?.type == 'terminal') {
                const rawCommand = result.dataMessage.message;
                const encodedArgs = encodeURIComponent(JSON.stringify({ command: rawCommand }));

                stream.markdown(`\n\`\`\`bash\n${rawCommand}\n\`\`\`\n`);

                const buttonMd = new vscode.MarkdownString(
                    `[$(terminal) Run Command](command:myCompilerExtension.runTerminalCommand?${encodedArgs})`,
                    true
                );
                buttonMd.isTrusted = { enabledCommands: ['myCompilerExtension.runTerminalCommand'] };
                stream.markdown(buttonMd);

                processing = false;

            } else if (result.dataMessage?.type === 'step_actions') {
                const stepPlan = result.dataMessage.stepPlanError;

                if (stepPlan?.errorSummary) {
                    stream.markdown(`### Error Analysis\n${stepPlan.errorSummary}\n\n`);
                }

                if (stepPlan?.steps && stepPlan.steps.length > 0) {
                    stream.markdown(`**Suggested fix steps:**\n\n`);
                    for (const step of stepPlan.steps) {
                        const stepLabel = [step.id ? `Step ${step.id}` : '', step.title].filter(Boolean).join(': ');
                        stream.markdown(`**${stepLabel}**\n`);
                        if (step.description) {
                            stream.markdown(`${step.description}\n\n`);
                        }
                    }
                    const encodedArgs = encodeURIComponent(JSON.stringify(stepPlan.steps));
                    const buttonMd = new vscode.MarkdownString(
                        `[$(wrench) Apply All Steps](command:manager-extension.applyResolutionStep?${encodedArgs})`,
                        true
                    );
                    buttonMd.isTrusted = { enabledCommands: ['manager-extension.applyResolutionStep'] };
                    stream.markdown(buttonMd);
                }

                processing = false;

            } else {
                // No tool call returned. The agent gave its final message, we can stop looping.
                processing = false;
            }
        }

    } catch (err) {
        stream.markdown(`❌ **Error:** ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function sendChatPayload(
    payload: any,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    outputChannel: vscode.OutputChannel
): Promise<{ dataMessage?: DataMessage }> {
    const body = JSON.stringify(payload);
    
    return new Promise((resolve, reject) => {
        let interceptedToolCall: any = null;
        let settled = false;

        const req = http.request({
            hostname: 'localhost',
            port: 8081,
            path: '/sub-agent-manager-chat/chat-stream',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res: IncomingMessage) => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`Backend error: ${res.statusCode} ${res.statusMessage}`));
                return;
            }

            res.setEncoding('utf8');
            let lineBuffer = '';

            res.on('data', (chunk: string) => {
                if (token.isCancellationRequested) {
                    req.destroy();
                    if (!settled) { settled = true; resolve({}); }
                    return;
                }

                const text = lineBuffer + chunk;
                const lines = text.split('\n');
                lineBuffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const dataStr = line.replace('data:', '').trim();
                        try {
                            const parsed: any = JSON.parse(dataStr);
                            outputChannel.appendLine('[SSE parsed] ' + JSON.stringify(parsed));

                            if (parsed.toolCall || parsed.type) {
                                // DataMessage arrived directly with type/toolCall at the top level
                                interceptedToolCall = parsed;
                            } else if (parsed.message) {
                                try {
                                    const maybeInner = JSON.parse(parsed.message);
                                    if (maybeInner && typeof maybeInner.name === 'string') {
                                        // Raw tool-call object: { name, arguments }
                                        if (maybeInner.argument && !maybeInner.arguments) {
                                            maybeInner.arguments = maybeInner.argument;
                                            delete maybeInner.argument;
                                        }
                                        interceptedToolCall = maybeInner;
                                        outputChannel.appendLine('[SSE] toolCall extracted from message field');
                                    } else if (maybeInner && maybeInner.type) {
                                        // DataMessage JSON string: { type, message?, toolCall? }
                                        if (maybeInner.toolCall?.argument && !maybeInner.toolCall?.arguments) {
                                            maybeInner.toolCall.arguments = maybeInner.toolCall.argument;
                                            delete maybeInner.toolCall.argument;
                                        }
                                        interceptedToolCall = maybeInner;
                                        outputChannel.appendLine('[SSE] DataMessage extracted from message field, type: ' + maybeInner.type);
                                    } else {
                                        stream.markdown(parsed.message);
                                    }
                                } catch {
                                    stream.markdown(parsed.message);
                                }
                            }
                        } catch (e) {
                            outputChannel.appendLine('[SSE parse error] ' + dataStr);
                        }
                    }
                }
            });

            res.on('end', () => {
                if (!settled) { settled = true; resolve({ dataMessage: interceptedToolCall }); }
            });
            
            res.on('error', reject);
        });

        req.setTimeout(120000, () => {
            req.destroy(new Error('Request timed out'));
        });
        
        req.on('error', reject);
        req.write(body);
        req.end();
    });
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
        return JSON.stringify({
            status: 'OK',
            project: targetFolder.name,
            buildTool: 'maven',
            buildFile: mavenFiles[0].fsPath
        });
    }

    if (npmFiles.length > 0) {
        return JSON.stringify({
            status: 'OK',
            project: targetFolder.name,
            buildTool: 'npm',
            buildFile: npmFiles[0].fsPath
        });
    }

    return JSON.stringify({
        status: 'OK',
        project: targetFolder.name,
        buildTool: 'unknown',
        buildFile: null
    });
}
