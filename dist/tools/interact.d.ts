export declare const clickDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            selector: {
                type: string;
                description: string;
            };
            text: {
                type: string;
                description: string;
            };
        };
    };
};
export declare const typeDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            selector: {
                type: string;
                description: string;
            };
            text: {
                type: string;
                description: string;
            };
            value: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function clickHandler(args: {
    selector?: string;
    text?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
} | {
    isError: boolean;
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function typeHandler(args: {
    selector?: string;
    text?: string;
    value?: string;
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
