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
exports.sendChatPayload = sendChatPayload;
const http = __importStar(require("http"));
async function sendChatPayload(payload, stream, token, outputChannel) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        let interceptedToolCall = null;
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
        }, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`Backend error: ${res.statusCode} ${res.statusMessage}`));
                return;
            }
            res.setEncoding('utf8');
            let lineBuffer = '';
            res.on('data', (chunk) => {
                if (token?.isCancellationRequested) {
                    req.destroy();
                    if (!settled) {
                        settled = true;
                        resolve({});
                    }
                    return;
                }
                const text = lineBuffer + chunk;
                const lines = text.split('\n');
                lineBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const dataStr = line.replace('data:', '').trim();
                        try {
                            const parsed = JSON.parse(dataStr);
                            outputChannel.appendLine('[SSE parsed] ' + JSON.stringify(parsed));
                            if (parsed.toolCall || parsed.type) {
                                // DataMessage arrived directly with type/toolCall at the top level
                                interceptedToolCall = parsed;
                            }
                            else if (parsed.editDefect) {
                                // Patching agent response: DataMessage with editDefect payload
                                interceptedToolCall = parsed;
                                outputChannel.appendLine('[SSE] editDefect payload captured');
                            }
                            else if (parsed.message) {
                                try {
                                    const maybeInner = JSON.parse(parsed.message);
                                    if (maybeInner && typeof maybeInner.name === 'string') {
                                        // Raw tool-call object: { name, arguments }
                                        normalizeArguments(maybeInner);
                                        interceptedToolCall = maybeInner;
                                        outputChannel.appendLine('[SSE] toolCall extracted from message field');
                                    }
                                    else if (maybeInner && maybeInner.type) {
                                        // DataMessage JSON string: { type, message?, toolCall? }
                                        normalizeArguments(maybeInner.toolCall);
                                        interceptedToolCall = maybeInner;
                                        outputChannel.appendLine('[SSE] DataMessage extracted from message field, type: ' + maybeInner.type);
                                    }
                                    else {
                                        stream?.markdown(parsed.message);
                                    }
                                }
                                catch {
                                    stream?.markdown(parsed.message);
                                }
                            }
                        }
                        catch (e) {
                            outputChannel.appendLine('[SSE parse error] ' + dataStr);
                        }
                    }
                }
            });
            res.on('end', () => {
                if (!settled) {
                    settled = true;
                    resolve({ dataMessage: interceptedToolCall });
                }
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
function normalizeArguments(obj) {
    if (obj && obj.argument && !obj.arguments) {
        obj.arguments = obj.argument;
        delete obj.argument;
    }
}
//# sourceMappingURL=sendingChatPayload.js.map