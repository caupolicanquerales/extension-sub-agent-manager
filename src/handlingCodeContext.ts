import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DefectContext } from './interfaces';

export async function getCodeContext(defect: any, windowSize: number = 15): Promise<DefectContext | null> {
    const { filepath, line } = defect.coordinates;
    
    if (!filepath || line === null) {
        return null; // Cannot gather context without file coordinates
    }

    // 1. Resolve the file URI across all workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    let fileUri: vscode.Uri | null = null;

    if (path.isAbsolute(filepath) && fs.existsSync(filepath)) {
        fileUri = vscode.Uri.file(filepath);
    } else {
        for (const folder of workspaceFolders) {
            // Try joining directly with the workspace folder root
            const direct = path.join(folder.uri.fsPath, filepath);
            if (fs.existsSync(direct)) {
                fileUri = vscode.Uri.file(direct);
                break;
            }
            const viaParent = path.join(path.dirname(folder.uri.fsPath), filepath);
            if (fs.existsSync(viaParent)) {
                fileUri = vscode.Uri.file(viaParent);
                break;
            }
        }
    }

    if (!fileUri) return null;

    try {
        // 2. Open document in the background (does not force-open a visible tab yet)
        const document = await vscode.workspace.openTextDocument(fileUri);
        
        // Convert 1-based line from logs to VS Code's 0-based index
        const targetLineIndex = line - 1; 
        
        // 3. Define the context bounds
        const startLine = Math.max(0, targetLineIndex - windowSize);
        const endLine = Math.min(document.lineCount - 1, targetLineIndex + windowSize);
        
        return extractSnippet(document, startLine, endLine, targetLineIndex);
    } catch (error) {
        console.error(`Failed to read file for context gathering: ${fileUri?.fsPath ?? filepath}`, error);
        return null;
    }
}

function extractSnippet(document: vscode.TextDocument, start: number, end: number, target: number): DefectContext {
    const snippetLines: string[] = [];

    for (let i = start; i <= end; i++) {
        const lineText = document.lineAt(i).text;
        const lineNumberPrefix = `[Line ${i + 1}] `;
        
        if (i === target) {
            snippetLines.push(`${lineNumberPrefix}👉 ${lineText} // ERROR LOCATION`);
        } else {
            snippetLines.push(`${lineNumberPrefix}${lineText}`);
        }
    }

    return {
        startLine: start + 1,       // convert back to 1-based for the agent
        endLine: end + 1,
        targetLine: target + 1,
        codeSnippet: snippetLines.join('\n'),
        languageId: document.languageId
    };
}