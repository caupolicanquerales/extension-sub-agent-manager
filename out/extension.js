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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const chatHandler_1 = require("./chatHandler");
const handlingTerminalCommands_1 = require("./handlingTerminalCommands");
const applyingContentFile_1 = require("./applyingContentFile");
const handlingErrorLogs_1 = require("./handlingErrorLogs");
const handlingCodeContext_1 = require("./handlingCodeContext");
const sendingChatPayload_1 = require("./sendingChatPayload");
function activate(context) {
    const originalContentProvider = new applyingContentFile_1.OriginalContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(applyingContentFile_1.OriginalContentProvider.scheme, originalContentProvider));
    const patchCodeLensProvider = new applyingContentFile_1.PatchCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, patchCodeLensProvider));
    context.subscriptions.push(vscode.commands.registerCommand('manager-extension.keepPatch', (uriStr) => {
        patchCodeLensProvider.decide(uriStr, 'keep');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('manager-extension.undoPatch', (uriStr) => {
        patchCodeLensProvider.decide(uriStr, 'undo');
    }));
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
            const logs = (0, handlingErrorLogs_1.stripAnsiCodes)(chunks.join(''));
            (0, handlingErrorLogs_1.sendErrorToAgent)(commandLine.value, exitCode, logs);
        }
        executionBuffers.delete(event.execution);
    });
    context.subscriptions.push(executionListener);
    const pendingStepsStore = new Map();
    const outputChannel = vscode.window.createOutputChannel('Sub Agent Manager');
    context.subscriptions.push(outputChannel);
    const applyStepsDisposable = vscode.commands.registerCommand('manager-extension.applyResolutionStep', async (stepsId) => {
        const steps = pendingStepsStore.get(stepsId);
        if (!steps) {
            vscode.window.showErrorMessage("Resolution steps not found or already applied.");
            return;
        }
        pendingStepsStore.delete(stepsId);
        // Tracks the FIRST content of each file before any step touches it.
        // Used to show a single accurate diff per file after all steps finish.
        const originalSnapshots = new Map();
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Executing Resolution Plan",
            cancellable: false
        }, async (progress) => {
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const stepLabel = `Step ${i + 1}/${steps.length}: ${step.title}`;
                progress.report({ message: stepLabel });
                try {
                    if (step.type === 'command') {
                        await (0, handlingTerminalCommands_1.executeCommandStep)(step);
                    }
                }
                catch (error) {
                    const errorDetail = error instanceof Error ? error.message : String(error);
                    outputChannel.appendLine(`\n❌ Failed at step "${step.title}":\n${errorDetail}`);
                    outputChannel.show(true);
                    vscode.window.showErrorMessage(`❌ Failed at "${step.title}". See "Sub Agent Manager" output for details.`);
                    return;
                }
            }
            vscode.window.showInformationMessage("🎉 All resolution steps applied successfully!");
        });
        // Diff + Keep/Undo MUST run outside withProgress — the progress
        // notification occupies the notification slot and prevents
        // showInformationMessage buttons from appearing.
        for (const [fsPath, originalContent] of originalSnapshots) {
            const fileName = path.basename(fsPath);
            const tempPath = path.join(os.tmpdir(), `agent-original-${Date.now()}-${fileName}`);
            fs.writeFileSync(tempPath, originalContent, 'utf8');
            await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(tempPath), vscode.Uri.file(fsPath), `Agent Fix: ${fileName} (original ↔ modified)`);
            const choice = await vscode.window.showInformationMessage(`Agent applied changes to ${fileName}. Keep or undo?`, { modal: true }, 'Keep Changes', 'Undo Changes');
            if (choice === 'Undo Changes') {
                fs.writeFileSync(fsPath, originalContent, 'utf8');
                const doc = await vscode.workspace.openTextDocument(fsPath);
                await doc.save();
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
                vscode.window.showInformationMessage(`↩️ Reverted changes to ${fileName}.`);
            }
            else {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
        }
    });
    context.subscriptions.push(applyStepsDisposable);
    let fixCommand = vscode.commands.registerCommand('manager-extension.fixDefect', async (stepsId) => {
        const defects = pendingStepsStore.get(stepsId);
        if (!defects || defects.length === 0) {
            vscode.window.showErrorMessage('No defects received to fix.');
            return;
        }
        pendingStepsStore.delete(stepsId);
        const appliedPatches = [];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Preparing fix for ${defects.length} defect(s)...`,
            cancellable: false
        }, async (progress) => {
            for (const defect of defects) {
                progress.report({ message: `Gathering context for ${defect.id}...` });
                const enrichedContext = await (0, handlingCodeContext_1.getCodeContext)(defect, 15);
                if (!enrichedContext) {
                    vscode.window.showErrorMessage(`Could not read source file context for ${defect?.coordinates?.filepath}`);
                    continue;
                }
                defect.context = enrichedContext;
                const currentPayload = {
                    prompt: "[INPUT_DEFECT: DEFECT]" + JSON.stringify(defect),
                    conversationId: crypto.randomUUID()
                };
                progress.report({ message: `Generating precise patch for ${defect.id}...` });
                const result = await (0, sendingChatPayload_1.sendChatPayload)(currentPayload, undefined, undefined, outputChannel);
                const patch = await (0, applyingContentFile_1.executeFileEditStep)(result?.dataMessage?.editDefect, originalContentProvider, patchCodeLensProvider);
                if (patch) {
                    appliedPatches.push(patch);
                }
            }
        });
        // Confirm/revert each patch outside the progress block so the spinner
        // stops before the diff view and Keep/Undo notification appear.
        for (const patch of appliedPatches) {
            if (patch) {
                await (0, applyingContentFile_1.confirmAppliedPatch)(patch);
            }
        }
    });
    context.subscriptions.push(fixCommand);
    const agent = vscode.chat.createChatParticipant('my-sub-agent-manager', async (request, context, stream, token) => {
        await (0, chatHandler_1.handleChatRequest)(request, context, stream, token, outputChannel, pendingStepsStore);
    });
    context.subscriptions.push(agent);
}
//# sourceMappingURL=extension.js.map