
export interface ToolArgument {
    projectName?: string;
    actionOverProject?: string;
}

export interface Payload {
    command?: string;
    cwd?: string | null;
    filepath?: string;
    pathType?: string;
    line?: string;
    context?: string;
    insertionMode?: string;
    find?: string;
    replace?: string;
    instruction?: string;
}

export interface Step {
    id?: string;
    title?: string;
    description?: string;
    type?: string;
    waitForCompletion?: boolean;
    payload?: Payload;
}

export interface Coordinates {
    filepath: string | null;
    pathType: string | null;
    line: number | null;
    column: number | null;
}

export interface DefectContext {
    startLine: number;
    endLine: number;
    targetLine: number;
    codeSnippet: string;
    languageId?: string; 
}

export interface Defect {
    id?: string;
    title?: string;
    description?: string;
    severity?: string;
    category?: string;
    coordinates?: Coordinates;
    context?: DefectContext;
}

export interface DataDefects {
    totalDefectsFound?: number;
    defects?: Defect[];
}

export interface EditDefect {
    action: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    content: string;
}

export interface DataEditDefect {
    id: string;
    filepath: string;
    status: string;
    explanation: string;
    edits: EditDefect[];
}

export interface DataMessage {
    message?: string;
    type?: string;
    toolCall?: {
        name: string;
        arguments?: ToolArgument[];
    };
    stepPlanError?: {
        errorSummary?: string;
        detectedLanguage?: string;
        detectedFramework?: string;
        errorType?: string[];
        steps?: Step[];
    };
    defects?: DataDefects;
    editDefect?: DataEditDefect;
}