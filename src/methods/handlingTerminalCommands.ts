import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

function resolveCwd(relativeCwd: string | null | undefined): string | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!relativeCwd) {
        return folders[0]?.uri.fsPath;
    }
    // If already absolute, verify it exists and return it
    if (path.isAbsolute(relativeCwd)) {
        return fs.existsSync(relativeCwd) ? relativeCwd : folders[0]?.uri.fsPath;
    }
    // Search every workspace folder for a matching subdirectory
    for (const folder of folders) {
        // 1. Direct join
        const direct = path.join(folder.uri.fsPath, relativeCwd);
        if (fs.existsSync(direct)) {
            return direct;
        }
        // 2. Via parent — handles LLM prefixing cwd with the project folder name
        const viaParent = path.join(path.dirname(folder.uri.fsPath), relativeCwd);
        if (fs.existsSync(viaParent)) {
            return viaParent;
        }
    }
    // Last resort: resolve against the first workspace root
    return folders[0]?.uri.fsPath;
}

export function executeCommandStep(step: any): Promise<void> {
    return new Promise((resolve, reject) => {
        const payload = step.payload;
        const execOptions = {
            cwd: resolveCwd(payload.cwd),
            maxBuffer: 10 * 1024 * 1024, // 10 MB — Maven output can be large
            env: {
                ...process.env,
                PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin:/usr/share/maven/bin:/opt/maven/bin`
            }
        };

        exec(payload.command, execOptions, (error, stdout, stderr) => {
            if (error && step.waitForCompletion) {
                // Maven (and many build tools) write errors to stdout, not stderr
                const detail = stderr?.trim() || stdout?.trim() || error.message;
                reject(new Error(`Command failed: ${payload.command}\n${detail}`));
                return;
            }
            resolve();
        });
    });
}