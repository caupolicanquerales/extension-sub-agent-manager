
export interface ToolArgument {
    projectName?: string;
    actionOverProject?: string;
}

export interface Payload {
    command?: string;
    filepath?: string;
    find?: string;
    replace?: string;
}

export interface Step {
    id?: string;
    title?: string;
    description?: string;
    type?: string;
    payload?: Payload;
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
        steps?: Step[];
    }
}