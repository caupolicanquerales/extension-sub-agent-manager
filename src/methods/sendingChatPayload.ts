import * as vscode from 'vscode';
import * as http from 'http';
import type { IncomingMessage } from 'http';
import { DataMessage } from '../interfaces/interfaces';

export async function sendChatPayload(
    payload: any,
    stream: vscode.ChatResponseStream | undefined,
    token: vscode.CancellationToken | undefined,
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
                if (token?.isCancellationRequested) {
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
                            } else if (parsed.editDefect) {
                                // Patching agent response: DataMessage with editDefect payload
                                interceptedToolCall = parsed;
                                outputChannel.appendLine('[SSE] editDefect payload captured');
                            } else if (parsed.message) {
                                try {
                                    const maybeInner = JSON.parse(parsed.message);
                                    if (maybeInner && typeof maybeInner.name === 'string') {
                                        // Raw tool-call object: { name, arguments }
                                        normalizeArguments(maybeInner);
                                        interceptedToolCall = maybeInner;
                                        outputChannel.appendLine('[SSE] toolCall extracted from message field');
                                    } else if (maybeInner && maybeInner.type) {
                                        // DataMessage JSON string: { type, message?, toolCall? }
                                        normalizeArguments(maybeInner.toolCall);
                                        interceptedToolCall = maybeInner;
                                        outputChannel.appendLine('[SSE] DataMessage extracted from message field, type: ' + maybeInner.type);
                                    } else {
                                        stream?.markdown(parsed.message);
                                    }
                                } catch {
                                    stream?.markdown(parsed.message);
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

function normalizeArguments(obj: any): void {
    if (obj && obj.argument && !obj.arguments) {
        obj.arguments = obj.argument;
        delete obj.argument;
    }
}