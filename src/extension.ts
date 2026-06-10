// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';


interface DataMessage {
	content?: string;
}

export function activate(context: vscode.ExtensionContext) {

	const DATA_URL_SUB_CHAT_AGENT_MANAGER = 'http://localhost:8085/sub-agent-manager-chat/chat-stream';

	const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        const uuid = crypto.randomUUID();
        stream.progress('Thinking...');

        try {
			const response = await fetch(DATA_URL_SUB_CHAT_AGENT_MANAGER, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream' // Request SSE format
                },
                body: JSON.stringify({
                    prompt: request.prompt,
					conversationId: uuid
                }),
                signal: AbortSignal.timeout(30000)
			});

			if (!response.ok || !response.body) {
                throw new Error(`Backend error: ${response.statusText}`);
            }

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

			let buffer = '';
			outer: while (true) {
                if (token.isCancellationRequested) {
                    reader.cancel();
                    break;
                }

                const { value, done } = await reader.read();
                if (done) break;

                buffer += value;
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; 

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // SSE events generally start with the 'data:' prefix
                    if (trimmed.startsWith('data:')) {
                        const rawData = trimmed.substring(5).trim();
                        
                        if (rawData === '[DONE]') break outer;

                        try {
                            const parsed: DataMessage = JSON.parse(rawData);
                            if (parsed.content) {
                                stream.markdown(parsed.content);
                            }
                        } catch (e) {
                            console.error("Failed to parse SSE chunk:", rawData);
                        }
                    }
                }
            }

        } catch (err) {
            stream.markdown(`❌ **Error:** ${err instanceof Error ? err.message : String(err)}`);
        }
    });
	
	context.subscriptions.push(agent);
}

export function deactivate() {}
