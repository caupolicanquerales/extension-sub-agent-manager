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
exports.getCodeContext = getCodeContext;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
async function getCodeContext(defect, windowSize = 15) {
    const { filepath, line } = defect.coordinates;
    if (!filepath || line === null) {
        return null; // Cannot gather context without file coordinates
    }
    // 1. Resolve the file URI across all workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders)
        return null;
    let fileUri = null;
    if (path.isAbsolute(filepath) && fs.existsSync(filepath)) {
        fileUri = vscode.Uri.file(filepath);
    }
    else {
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
    if (!fileUri)
        return null;
    try {
        // 2. Open document in the background (does not force-open a visible tab yet)
        const document = await vscode.workspace.openTextDocument(fileUri);
        // Convert 1-based line from logs to VS Code's 0-based index
        const targetLineIndex = line - 1;
        // 3. Define the context bounds
        const startLine = Math.max(0, targetLineIndex - windowSize);
        const endLine = Math.min(document.lineCount - 1, targetLineIndex + windowSize);
        return extractSnippet(document, startLine, endLine, targetLineIndex);
    }
    catch (error) {
        console.error(`Failed to read file for context gathering: ${fileUri?.fsPath ?? filepath}`, error);
        return null;
    }
}
function extractSnippet(document, start, end, target) {
    const snippetLines = [];
    for (let i = start; i <= end; i++) {
        const lineText = document.lineAt(i).text;
        const lineNumberPrefix = `[Line ${i + 1}] `;
        if (i === target) {
            snippetLines.push(`${lineNumberPrefix}👉 ${lineText} // ERROR LOCATION`);
        }
        else {
            snippetLines.push(`${lineNumberPrefix}${lineText}`);
        }
    }
    return {
        startLine: start + 1, // convert back to 1-based for the agent
        endLine: end + 1,
        targetLine: target + 1,
        codeSnippet: snippetLines.join('\n'),
        languageId: document.languageId
    };
}
//# sourceMappingURL=handlingCodeContext.js.map