import * as vscode from 'vscode';
import * as http from 'http';
import type { IncomingMessage } from 'http';

interface DataMessage {
    message?: string;
    toolCall?: {
        name: string;
        arguments?: {
            "projectName"?: string;
        };
    };
}

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

            if (result.toolCall) {
                const toolName = result.toolCall.name;
                outputChannel.appendLine(`[Agent Loop] Executing tool: ${toolName}`);
                
                // Handle the tool locally
                let toolResult = '';
                if (toolName === 'getProjectMetadata') {
                    const args = result.toolCall.arguments || {};
                    stream.progress(`Scanning layout for ${args.projectName || 'project'}...`);
                    toolResult = await executeWorkspaceScan(args.projectName, outputChannel);
                } else {
                    toolResult = `Error: Tool ${toolName} is not implemented in this extension-sub-agent-manager extension.`;
                }

                // Prepare the next payload to send the tool output back to the agent manager
                currentPayload = {
                    conversationId: conversationId,
                    toolResponse: {
                        name: toolName,
                        output: toolResult
                    }
                };
                
                stream.progress('Processing tool data...');
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
): Promise<{ toolCall?: any }> {
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
                            const parsed: DataMessage = JSON.parse(dataStr);
                            outputChannel.appendLine('[SSE parsed] ' + JSON.stringify(parsed));

                             if (parsed.message) {
                                stream.markdown(parsed.message);
                            }

                            if (parsed.toolCall) {
                                interceptedToolCall = parsed.toolCall;
                            }
                        } catch (e) {
                            outputChannel.appendLine('[SSE parse error] ' + dataStr);
                        }
                    }
                }
            });

            res.on('end', () => {
                if (!settled) { settled = true; resolve({ toolCall: interceptedToolCall }); }
            });
            
            res.on('error', reject);
        });

        req.setTimeout(30000, () => {
            req.destroy(new Error('Request timed out'));
        });
        
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}


async function executeWorkspaceScan(targetProjectName: string | undefined, outputChannel: vscode.OutputChannel): Promise<string> {
    const folders = vscode.workspace.workspaceFolders;
    
    if (!folders || folders.length === 0) {
        return "ERROR: No workspace folders are currently open.";
    }

    let targetFolder = folders[0]; // Fallback to the first folder if no name is provided

    if (targetProjectName) {
        const cleanedName = targetProjectName.toLowerCase().trim();
        const found = folders.find(f => f.name.toLowerCase().includes(cleanedName));
        
        if (found) {
            targetFolder = found;
        } else {
            return `ERROR: Could not find a project folder matching the name "${targetProjectName}" in the workspace. Available folders are: ${folders.map(f => f.name).join(', ')}`;
        }
    }

    outputChannel.appendLine(`[Workspace Scan] Narrowing search to folder: ${targetFolder.name}`);

    // Create a RelativePattern to search ONLY inside this specific project directory
    const mavenPattern = new vscode.RelativePattern(targetFolder, '**/pom.xml');
    const npmPattern = new vscode.RelativePattern(targetFolder, '**/package.json');

    // Run the scoped searches
    const mavenFiles = await vscode.workspace.findFiles(mavenPattern, '**/target/**', 1);
    const npmFiles = await vscode.workspace.findFiles(npmPattern, '**/node_modules/**', 1);

    if (mavenFiles.length > 0) {
        return `FOUND in project [${targetFolder.name}]: Maven project structure. Contains 'pom.xml'. Suggested compilation method: Maven build. Path: ${mavenFiles[0].fsPath}`;
    } 
    if (npmFiles.length > 0) {
        return `FOUND in project [${targetFolder.name}]: Node.js project structure. Contains 'package.json'. Suggested compilation method: npm run build. Path: ${npmFiles[0].fsPath}`;
    }

    return `FOUND in project [${targetFolder.name}]: Generic project layout. No explicit build configurations recognized.`;
}
