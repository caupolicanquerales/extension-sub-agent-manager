import * as vscode from 'vscode';
import { getCodeContext } from './handlingCodeContext';
import { sendChatPayload } from './sendingChatPayload';
import { executeFileEditStep, confirmAppliedPatch, OriginalContentProvider, PatchCodeLensProvider } from './applyingContentFile';
import { Defect } from '../interfaces/interfaces';


export async function processFixDefectSteps(
    stepsId: string,
    outputChannel: vscode.OutputChannel,
    pendingStepsStore: Map<string, Defect[]>,
    originalContentProvider: OriginalContentProvider,
    patchCodeLensProvider: PatchCodeLensProvider,
    stream?: vscode.ChatResponseStream
) {
    const defects = pendingStepsStore.get(stepsId) as Defect[] | undefined;
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

        const appliedPatches: Awaited<ReturnType<typeof executeFileEditStep>>[] = [];

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

                const enrichedContext = await getCodeContext(defect, 15);

                if (!enrichedContext) {
                    const errMsg = `Could not read source file: \`${defect?.coordinates?.filepath}\``;
                    stream?.markdown(`\n> ⚠ ${errMsg}\n`);
                    outputChannel.appendLine(`       ✗  Could not read source file: ${defect?.coordinates?.filepath}`);
                    vscode.window.showErrorMessage(`Could not read source file context for ${defect?.coordinates?.filepath}`);
                    continue;
                }

                outputChannel.appendLine(`       ✓  Context loaded — ${defect?.coordinates?.filepath}`);

                defect.context = enrichedContext;
                const currentPayload: any = {
                    prompt: "[INPUT_DEFECT: DEFECT]"+JSON.stringify(defect),
                    conversationId: crypto.randomUUID()
                };

                const patchMsg = `${step} Generating patch for \`${defect.id}\`…`;
                stream?.progress(patchMsg);
                progress.report({ message: patchMsg });
                outputChannel.appendLine(`${step}  ✨  Generating precise patch for defect ${defect.id}…`);

                const result = await sendChatPayload(currentPayload, undefined, undefined, outputChannel);

                const patch = await executeFileEditStep(result?.dataMessage?.editDefect, originalContentProvider, patchCodeLensProvider);
                if (patch) {
                    outputChannel.appendLine(`       ✓  Patch ready — ${patch.fileName}`);
                    appliedPatches.push(patch);
                } else {
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
                const decision = await confirmAppliedPatch(patch, outputChannel);
                if (decision === 'keep') { keptCount++; } else { revertedCount++; }
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

