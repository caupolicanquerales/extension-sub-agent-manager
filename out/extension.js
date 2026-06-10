"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
function activate(context) {
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
                if (done)
                    break;
                buffer += value;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    // SSE events generally start with the 'data:' prefix
                    if (trimmed.startsWith('data:')) {
                        const rawData = trimmed.substring(5).trim();
                        if (rawData === '[DONE]')
                            break outer;
                        try {
                            const parsed = JSON.parse(rawData);
                            if (parsed.content) {
                                stream.markdown(parsed.content);
                            }
                        }
                        catch (e) {
                            console.error("Failed to parse SSE chunk:", rawData);
                        }
                    }
                }
            }
        }
        catch (err) {
            stream.markdown(`❌ **Error:** ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    context.subscriptions.push(agent);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map