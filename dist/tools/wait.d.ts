export declare const definition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            selector: {
                type: string;
                description: string;
            };
            gone: {
                type: string;
                description: string;
            };
            role: {
                type: string;
                description: string;
            };
            expression: {
                type: string;
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
    };
};
interface WaitArgs {
    selector?: string;
    gone?: string;
    role?: string;
    expression?: string;
    timeout?: number;
}
export declare function handler(args: WaitArgs): Promise<{
    isError: boolean;
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
export {};
