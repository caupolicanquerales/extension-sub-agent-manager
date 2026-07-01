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
exports.processFixDefectSteps = processFixDefectSteps;
const vscode = __importStar(require("vscode"));
const handlingCodeContext_1 = require("./handlingCodeContext");
const sendingChatPayload_1 = require("./sendingChatPayload");
const applyingContentFile_1 = require("./applyingContentFile");
async function processFixDefectSteps(stepsId, outputChannel, pendingStepsStore, originalContentProvider, patchCodeLensProvider, stream) {
    const defects = pendingStepsStore.get(stepsId);
    if (!defects || defects.length === 0) {
        vscode.window.showErrorMessage('No defects received to fix.');
        return;
    }
    pendingStepsStore.delete(stepsId);
    outputChannel.show(true);
    outputChannel.appendLine('');
    outputChannel.appendLine(`${'─'.repeat(60)}`);
    outputChannel.appendLine(`▶  Sub Agent — fixing ${defects.length} defect(s)   ${new Date().toLocaleTimeString()}`);
    outputChannel.appendLine(`${'─'.repeat(60)}`);
    const appliedPatches = [];
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: 'Sub Agent: fixing defects',
        cancellable: false
    }, async (progress) => {
        for (let i = 0; i < defects.length; i++) {
            const defect = defects[i];
            const step = `[${i + 1}/${defects.length}]`;
            const gatherMsg = `${step} Gathering context for \`${defect.id}\`…`;
            stream?.progress(gatherMsg);
            progress.report({ message: gatherMsg });
            outputChannel.appendLine(`\n${step}  📂  Gathering context for defect ${defect.id}…`);
            const enrichedContext = await (0, handlingCodeContext_1.getCodeContext)(defect, 15);
            if (!enrichedContext) {
                const errMsg = `Could not read source file: \`${defect?.coordinates?.filepath}\``;
                stream?.markdown(`\n> ⚠ ${errMsg}\n`);
                outputChannel.appendLine(`       ✗  Could not read source file: ${defect?.coordinates?.filepath}`);
                vscode.window.showErrorMessage(`Could not read source file context for ${defect?.coordinates?.filepath}`);
                continue;
            }
            outputChannel.appendLine(`       ✓  Context loaded — ${defect?.coordinates?.filepath}`);
            defect.context = enrichedContext;
            const currentPayload = {
                prompt: "[INPUT_DEFECT: DEFECT]" + JSON.stringify(defect),
                conversationId: crypto.randomUUID()
            };
            const patchMsg = `${step} Generating patch for \`${defect.id}\`…`;
            stream?.progress(patchMsg);
            progress.report({ message: patchMsg });
            outputChannel.appendLine(`${step}  ✨  Generating precise patch for defect ${defect.id}…`);
            const result = await (0, sendingChatPayload_1.sendChatPayload)(currentPayload, undefined, undefined, outputChannel);
            const patch = await (0, applyingContentFile_1.executeFileEditStep)(result?.dataMessage?.editDefect, originalContentProvider, patchCodeLensProvider);
            if (patch) {
                outputChannel.appendLine(`       ✓  Patch ready — ${patch.fileName}`);
                appliedPatches.push(patch);
            }
            else {
                stream?.markdown(`\n> ⚠ No actionable patch generated for defect \`${defect.id}\`\n`);
                outputChannel.appendLine(`       ⚠  No actionable patch generated for defect ${defect.id}`);
            }
        }
        outputChannel.appendLine(``);
        outputChannel.appendLine(`✔  All patches prepared — awaiting your review in the diff editor.`);
    });
    if (appliedPatches.length > 0) {
        stream?.progress(`Waiting for your review in the diff editor…`);
    }
    // Confirm/revert each patch outside the progress block so the spinner
    // stops before the diff view and Keep/Undo CodeLens appear.
    let keptCount = 0;
    let revertedCount = 0;
    for (const patch of appliedPatches) {
        if (patch) {
            const decision = await (0, applyingContentFile_1.confirmAppliedPatch)(patch, outputChannel);
            if (decision === 'keep') {
                keptCount++;
            }
            else {
                revertedCount++;
            }
        }
    }
    const summary = appliedPatches.length === 0
        ? `No actionable patches were generated.`
        : `${keptCount} patch(es) applied, ${revertedCount} reverted.`;
    outputChannel.appendLine(`✔  Done — ${summary}`);
    outputChannel.appendLine(`${'─'.repeat(60)}`);
    outputChannel.appendLine(``);
    stream?.markdown(`\n---\n**Done** — ${summary}\n`);
    vscode.window.showInformationMessage(`$(check) Sub Agent finished — ${summary}`);
}
//# sourceMappingURL=handlingFixDefect.js.map