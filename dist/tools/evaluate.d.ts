export declare const definition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            expression: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function handler(args: {
    expression: string;
}): Promise<{
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
