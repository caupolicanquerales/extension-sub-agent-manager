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
exports.executeCommandStep = executeCommandStep;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function resolveCwd(relativeCwd) {
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
function executeCommandStep(step) {
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
        (0, child_process_1.exec)(payload.command, execOptions, (error, stdout, stderr) => {
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
//# sourceMappingURL=handlingTerminalCommands.js.map