import { FlowInput } from '../flow-compiler.js';
export declare const definition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            steps: {
                type: string;
                description: string;
            };
            bail: {
                type: string;
                enum: string[];
                description: string;
            };
            outputMaxBytes: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function flowHandler(args: Partial<FlowInput>): Promise<{
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
