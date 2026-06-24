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
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const chatHandler_1 = require("./chatHandler");
function activate(context) {
    let disposableCommand = vscode.commands.registerCommand('myCompilerExtension.runTerminalCommand', (args) => {
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
    const executionBuffers = new Map();
    const startListener = vscode.window.onDidStartTerminalShellExecution((event) => {
        if (event.terminal.name !== 'Agent Compiler') {
            return;
        }
        const chunks = [];
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
    const applyStepCommand = vscode.commands.registerCommand('manager-extension.applyResolutionStep', async (step) => {
        if (step.type === 'command') {
            // Execute the command directly in the integrated terminal
            const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Agent Fixes');
            terminal.show();
            terminal.sendText(step.payload?.command || '');
        }
        else if (step.type === 'file_edit') {
            // Example: Write content or notify user
            vscode.window.showInformationMessage(`Applying path fix for step ${step.id}...`);
            // Implement your file manipulation or workspace edit here
        }
    });
    context.subscriptions.push(applyStepCommand);
    const outputChannel = vscode.window.createOutputChannel('Sub Agent Manager');
    context.subscriptions.push(outputChannel);
    const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        await (0, chatHandler_1.handleChatRequest)(request, context, stream, token, outputChannel);
    });
    context.subscriptions.push(agent);
}
function stripAnsiCodes(str) {
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    return str.replace(ansiRegex, '');
}
function sendErrorToAgent(command, exitCode, logs) {
    const errorMessage = `[INPUT_ERROR: LOGS] An error occurred while executing the command.\n\n` +
        `**Command:** \`${command}\`\n` +
        `**Exit Code:** ${exitCode}\n` +
        `**Logs:**\n\`\`\`text\n${logs}\n\`\`\`\n\n` +
        `Please analyze this error and provide a fix.`;
    vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@sub-agent-manager ${errorMessage}`,
        isPartialQuery: false
    });
}
//# sourceMappingURL=extension.js.map