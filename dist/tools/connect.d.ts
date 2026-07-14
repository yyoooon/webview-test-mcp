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
        };
    };
};
interface ConnectArgs {
    socketIndex?: number;
    app?: string;
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
