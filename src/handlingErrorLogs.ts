import * as vscode from 'vscode';

export function stripAnsiCodes(str: string): string {
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    return str.replace(ansiRegex, '');
}

export function sendErrorToAgent(command: string, exitCode: number, logs: string) {
    const errorMessage =
        `[INPUT_ERROR: LOGS] An error occurred while executing the command.\n\n` +
        `**Command:** \`${command}\`\n` +
        `**Exit Code:** ${exitCode}\n` +
        `**Logs:**\n\`\`\`text\n${logs}\n\`\`\`\n\n` +
        `Please analyze this error and provide a fix.`;

    vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@sub-agent-manager ${errorMessage}`,
        isPartialQuery: false
    });
}