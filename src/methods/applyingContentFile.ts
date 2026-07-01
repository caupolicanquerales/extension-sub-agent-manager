import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DataEditDefect } from '../interfaces/interfaces';

/**
 * Read-only content provider for the "before" side of the patch diff view.
 * Uses the scheme 'agent-original'. Because it is read-only, VS Code never
 * marks these documents as dirty and never shows a "save changes?" dialog.
 */
export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'agent-original';
    private readonly _store = new Map<string, string>();

    set(uri: vscode.Uri, content: string): void {
        this._store.set(uri.toString(), content);
    }

    delete(uri: vscode.Uri): void {
        this._store.delete(uri.toString());
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this._store.get(uri.toString()) ?? '';
    }
}

/**
 * CodeLens provider that places "✓ Keep" and "↩ Undo" buttons directly above
 * the first changed line in the patched file. Each entry resolves a Promise
 * so that confirmAppliedPatch can await the user's decision without any modal.
 */
type PatchDecision = 'keep' | 'undo';

export class PatchCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    private _pending = new Map<string, {
        firstLine: number;
        resolve: (d: PatchDecision) => void;
    }>();

    /**
     * Registers a pending patch and returns a Promise that resolves when the
     * user clicks Keep or Undo.
     */
    register(fileUri: vscode.Uri, firstLine: number): Promise<PatchDecision> {
        return new Promise(resolve => {
            this._pending.set(fileUri.toString(), { firstLine, resolve });
            this._onDidChange.fire();
        });
    }

    /** Called by the keep/undo commands to resolve the pending Promise. */
    decide(fileUriStr: string, decision: PatchDecision): void {
        const entry = this._pending.get(fileUriStr);
        if (entry) {
            this._pending.delete(fileUriStr);
            this._onDidChange.fire();
            entry.resolve(decision);
        }
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const entry = this._pending.get(document.uri.toString());
        if (!entry) { return []; }
        // 0-indexed line for VS Code; agent lines are 1-indexed
        const line = Math.max(0, entry.firstLine - 1);
        const range = new vscode.Range(line, 0, line, 0);
        const uriStr = document.uri.toString();
        return [
            new vscode.CodeLens(range, {
                title: '$(check) Keep patch',
                command: 'manager-extension.keepPatch',
                arguments: [uriStr]
            }),
            new vscode.CodeLens(range, {
                title: '$(discard) Undo patch',
                command: 'manager-extension.undoPatch',
                arguments: [uriStr]
            })
        ];
    }
}

function normalizeEscapes(value: string): string {
    return value
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r');
}

function resolveFileUri(filepath: string): vscode.Uri {
    if (path.isAbsolute(filepath) && fs.existsSync(filepath)) {
        return vscode.Uri.file(filepath);
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        throw new Error("No open workspace folder found.");
    }
    for (const folder of folders) {
        const direct = path.join(folder.uri.fsPath, filepath);
        if (fs.existsSync(direct)) {
            return vscode.Uri.file(direct);
        }
        const viaParent = path.join(path.dirname(folder.uri.fsPath), filepath);
        if (fs.existsSync(viaParent)) {
            return vscode.Uri.file(viaParent);
        }
    }
    return vscode.Uri.joinPath(folders[0].uri, filepath);
}

function closeUntitledBuffer(_uri: vscode.Uri): void {
    // No-op: retained for signature compatibility. Virtual agent-original: docs
    // are cleaned up directly via OriginalContentProvider.delete().
}

export interface AppliedPatch {
    fileUri: vscode.Uri;
    document: vscode.TextDocument;
    originalContent: string;
    fileName: string;
    explanation: string;
    firstChangedLine: number;
    provider: OriginalContentProvider;
    codeLensProvider: PatchCodeLensProvider;
}

/**
 * Applies patch edits to the document buffer without saving or showing any UI.
 * Returns an AppliedPatch to be confirmed later, or undefined if skipped.
 * Safe to call inside a withProgress block.
 */
export async function executeFileEditStep(
    patchPayload: DataEditDefect | undefined,
    provider: OriginalContentProvider,
    codeLensProvider: PatchCodeLensProvider
): Promise<AppliedPatch | undefined> {

    if (!patchPayload) {
        vscode.window.showWarningMessage('Patch skipped: no patch payload received from the agent.');
        return undefined;
    }
    if (patchPayload.status !== 'SUCCESS') {
        vscode.window.showWarningMessage(`Patch unresolvable: ${patchPayload.explanation}`);
        return undefined;
    }
    if (!patchPayload.edits || patchPayload.edits.length === 0) {
        vscode.window.showWarningMessage(`Patch for "${patchPayload.filepath}" has no edits.`);
        return undefined;
    }

    const fileUri = resolveFileUri(patchPayload.filepath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const originalContent = document.getText();

    const workspaceEdit = new vscode.WorkspaceEdit();
    const sortedEdits = [...patchPayload.edits].sort((a, b) => b.startLine - a.startLine);

    for (const edit of sortedEdits) {
        const startPosition = new vscode.Position(edit.startLine - 1, edit.startColumn);
        const endPosition   = new vscode.Position(edit.endLine - 1, edit.endColumn);
        const targetRange   = new vscode.Range(startPosition, endPosition);

        switch (edit.action) {
            case 'DELETE':
                workspaceEdit.delete(fileUri, targetRange);
                break;
            case 'INSERT':
                workspaceEdit.insert(fileUri, startPosition, normalizeEscapes(edit.content));
                break;
            case 'REPLACE':
                workspaceEdit.replace(fileUri, targetRange, normalizeEscapes(edit.content));
                break;
            default:
                throw new Error(`Unknown patch action: "${edit.action}"`);
        }
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
        throw new Error(`Could not apply patch edits to: ${patchPayload.filepath}`);
    }

    // Lowest startLine across all edits = first changed line (1-indexed)
    const firstChangedLine = Math.min(...patchPayload.edits.map(e => e.startLine));

    return {
        fileUri,
        document,
        originalContent,
        fileName: path.basename(fileUri.fsPath),
        explanation: patchPayload.explanation,
        firstChangedLine,
        provider,
        codeLensProvider
    };
}

/**
 * Shows a diff view for an applied patch and prompts the user to keep or undo.
 * Must be called OUTSIDE any withProgress block so the diff view and notification
 * appear next to the editor, not inside the chat or progress overlay.
 */
export async function confirmAppliedPatch(
    patch: AppliedPatch,
    outputChannel?: vscode.OutputChannel
): Promise<PatchDecision> {
    const { fileUri, document, originalContent, fileName, explanation,
            firstChangedLine, provider, codeLensProvider } = patch;

    // Serve the original content via a read-only virtual URI (no dirty state, no save dialog)
    const originalUri = vscode.Uri
        .from({ scheme: OriginalContentProvider.scheme, path: fileUri.path });
    provider.set(originalUri, originalContent);

    // Temporarily enable CodeLens in the diff editor — it is off by default.
    // We restore the original value after the user decides.
    const diffEditorConfig = vscode.workspace.getConfiguration('diffEditor');
    const prevCodeLens = diffEditorConfig.get<boolean>('codeLens');
    await diffEditorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);

    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            fileUri,
            `Agent Patch: ${fileName} (original ↔ patched)`
        );

        // Register CodeLens on the patched file and await the user's click
        const decision = await codeLensProvider.register(fileUri, firstChangedLine);

        const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

        if (decision === 'undo') {
            statusItem.text = `$(loading~spin) Reverting patch on ${fileName}…`;
            statusItem.show();
            outputChannel?.appendLine(`↩  User chose to revert — restoring ${fileName}…`);
            const revertEdit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.lineAt(0).range.start,
                document.lineAt(document.lineCount - 1).range.end
            );
            revertEdit.replace(fileUri, fullRange, originalContent);
            await vscode.workspace.applyEdit(revertEdit);
            await vscode.workspace.save(fileUri);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            statusItem.text = `$(check) Reverted: ${fileName}`;
            outputChannel?.appendLine(`       ✓  Reverted — ${fileName}`);
        } else {
            statusItem.text = `$(loading~spin) Saving patch on ${fileName}…`;
            statusItem.show();
            outputChannel?.appendLine(`✔  User accepted patch — saving ${fileName}…`);
            await vscode.workspace.save(fileUri);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            statusItem.text = `$(check) Patch saved: ${fileName}`;
            outputChannel?.appendLine(`       ✓  Saved — ${explanation}`);
        }

        await new Promise<void>(resolve => setTimeout(resolve, 2500));
        statusItem.dispose();

        return decision;
    } finally {
        // Restore the original diffEditor.codeLens setting
        await diffEditorConfig.update('codeLens', prevCodeLens, vscode.ConfigurationTarget.Global);
        provider.delete(originalUri);
    }
}
