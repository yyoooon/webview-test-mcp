export declare const definition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            name: {
                type: string;
                description: string;
            };
            args: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function resolveScriptPath(name: string, cwd: string): string;
export declare function handler(args: {
    name: string;
    args?: Record<string, unknown>;
}): Promise<{
    isError: true;
    content: {
        type: "text";
        text: string;
    }[];
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
