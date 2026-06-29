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
exports.handleChatRequest = handleChatRequest;
const vscode = __importStar(require("vscode"));
const sendingChatPayload_1 = require("./sendingChatPayload");
function renderLabeledItems(stream, items) {
    for (const item of items) {
        const label = [item.id ? `Step ${item.id}` : '', item.title].filter(Boolean).join(': ');
        stream.markdown(`**${label}**\n`);
        if (item.description) {
            stream.markdown(`${item.description}\n\n`);
        }
    }
}
async function handleChatRequest(request, context, stream, token, outputChannel, pendingStepsStore) {
    const conversationId = crypto.randomUUID();
    stream.progress('Thinking...');
    try {
        let currentPayload = {
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
            const result = await (0, sendingChatPayload_1.sendChatPayload)(currentPayload, stream, token, outputChannel);
            if (result.dataMessage?.type === 'recursive' && result.dataMessage.toolCall) {
                const toolName = result.dataMessage.toolCall.name;
                outputChannel.appendLine(`[Agent Loop] Executing tool: ${toolName}`);
                let toolResult = '';
                if (toolName === 'getProjectMetadata') {
                    const args = (result.dataMessage.toolCall.arguments && result.dataMessage.toolCall.arguments[0]) || {};
                    stream.progress(`Scanning layout for ${args.projectName || 'project'}...`);
                    toolResult = await executeWorkspaceScan(args.projectName, args.actionOverProject, outputChannel);
                }
                else {
                    toolResult = `Error: Tool ${toolName} is not implemented in this extension-sub-agent-manager extension.`;
                }
                currentPayload = {
                    conversationId: conversationId,
                    prompt: toolResult
                };
                stream.progress('Processing tool data...');
            }
            else if (result.dataMessage?.type === 'terminal') {
                const rawCommand = result.dataMessage.message;
                const encodedArgs = encodeURIComponent(JSON.stringify({ command: rawCommand }));
                stream.markdown(`\n\`\`\`bash\n${rawCommand}\n\`\`\`\n`);
                const buttonMd = new vscode.MarkdownString(`[$(terminal) Run Command](command:myCompilerExtension.runTerminalCommand?${encodedArgs})`, true);
                buttonMd.isTrusted = { enabledCommands: ['myCompilerExtension.runTerminalCommand'] };
                stream.markdown(buttonMd);
                processing = false;
            }
            else if (result.dataMessage?.type === 'step_actions') {
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
                    const buttonMd = new vscode.MarkdownString(`[$(wrench) Apply All Steps](command:manager-extension.applyResolutionStep?${encodedArgs})`, true);
                    buttonMd.isTrusted = { enabledCommands: ['manager-extension.applyResolutionStep'] };
                    stream.markdown(buttonMd);
                }
                if (defectPlan?.defects && defectPlan.defects.length > 0) {
                    stream.markdown(`### Defects Found (${defectPlan.totalDefectsFound ?? defectPlan.defects.length})\n\n`);
                    renderLabeledItems(stream, defectPlan.defects);
                    const stepsId = crypto.randomUUID();
                    pendingStepsStore.set(stepsId, defectPlan?.defects);
                    const encodedArgs = encodeURIComponent(JSON.stringify([stepsId]));
                    const buttonMd = new vscode.MarkdownString(`[$(wrench) Apply All Steps](command:manager-extension.fixDefect?${encodedArgs})`, true);
                    buttonMd.isTrusted = { enabledCommands: ['manager-extension.fixDefect'] };
                    stream.markdown(buttonMd);
                }
                processing = false;
            }
            else {
                // No tool call returned. The agent gave its final message, we can stop looping.
                processing = false;
            }
        }
    }
    catch (err) {
        stream.markdown(`❌ **Error:** ${err instanceof Error ? err.message : String(err)}`);
    }
}
async function executeWorkspaceScan(targetProjectName, action, outputChannel) {
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
        }
        else {
            return JSON.stringify({
                status: 'ERROR',
                reason: `No folder matching "${targetProjectName}" found.`,
                availableFolders: folders.map(f => f.name)
            });
        }
    }
    outputChannel.appendLine(`[Workspace Scan] Scanning folder: ${targetFolder.name}`);
    const mavenFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(targetFolder, '**/pom.xml'), '**/target/**', 1);
    const npmFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(targetFolder, '**/package.json'), '**/node_modules/**', 1);
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
//# sourceMappingURL=chatHandler.js.map