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
exports.processRunProjectCommand = processRunProjectCommand;
const vscode = __importStar(require("vscode"));
const sendingChatPayload_1 = require("./sendingChatPayload");
const boxToDisplayCommand_1 = require("../elements/boxToDisplayCommand");
async function processRunProjectCommand(outputChannel, conversationId, stream) {
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
        const currentPayload = {
            prompt: "resend the terminal command",
            conversationId: conversationId
        };
        const result = await (0, sendingChatPayload_1.sendChatPayload)(currentPayload, undefined, undefined, outputChannel);
        if (result?.dataMessage) {
            outputChannel.appendLine(`✓  Command retrieved successfully`);
            if (stream) {
                (0, boxToDisplayCommand_1.displayBoxCommand)(result.dataMessage, stream);
            }
            else {
                const command = result.dataMessage.message ?? '';
                outputChannel.appendLine(`Command: ${command}`);
                const choice = await vscode.window.showInformationMessage(`Terminal command: ${command}`, 'Run Command');
                if (choice === 'Run Command') {
                    await vscode.commands.executeCommand('myCompilerExtension.runTerminalCommand', { command });
                }
            }
        }
        else {
            outputChannel.appendLine(`✗  No command returned by sub agent`);
            stream?.markdown(`\n> ⚠ No terminal command was returned by the sub agent.\n`);
            if (!stream) {
                vscode.window.showWarningMessage('No terminal command was returned by the sub agent.');
            }
        }
    });
}
//# sourceMappingURL=handlingRunProjectCommand.js.map