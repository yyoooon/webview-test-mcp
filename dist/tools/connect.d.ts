import { Platform } from "../platform.js";
export declare const definition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            socketIndex: {
                type: string;
                description: string;
            };
            app: {
                type: string;
                description: string;
            };
            platform: {
                type: string;
                enum: string[];
                description: string;
            };
        };
    };
};
interface ConnectArgs {
    socketIndex?: number;
    app?: string;
    platform?: Platform;
}
export declare function handler(args: ConnectArgs): Promise<{
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
export {};
