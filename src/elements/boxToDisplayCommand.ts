import * as vscode from 'vscode';
import { DataMessage } from "../interfaces/interfaces";

export function displayBoxCommand(dataMessage: DataMessage, stream: vscode.ChatResponseStream) {
    const rawCommand = dataMessage.message;
    const encodedArgs = encodeURIComponent(JSON.stringify({ command: rawCommand }));

    stream.markdown(`\n\`\`\`bash\n${rawCommand}\n\`\`\`\n`);

    const buttonMd = new vscode.MarkdownString(
        `[$(terminal) Run Command](command:myCompilerExtension.runTerminalCommand?${encodedArgs})`,
        true
    );
    buttonMd.isTrusted = { enabledCommands: ['myCompilerExtension.runTerminalCommand'] };
    stream.markdown(buttonMd);
} 