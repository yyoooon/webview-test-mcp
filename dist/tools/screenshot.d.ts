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
            format: {
                type: string;
                enum: string[];
                description: string;
            };
            quality: {
                type: string;
                description: string;
            };
        };
    };
};
export declare function handler(args?: {
    selector?: string;
    format?: 'png' | 'jpeg';
    quality?: number;
}): Promise<{
    isError: true;
    content: {
        type: "text";
        text: string;
    }[];
} | {
    content: {
        type: "image";
        data: string;
        mimeType: "image/jpeg" | "image/png";
    }[];
    isError?: undefined;
}>;
