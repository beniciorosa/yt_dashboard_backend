import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class YoutubeService {
    private apiKey: string;
    private baseUrl = 'https://www.googleapis.com/youtube/v3';

    constructor(private configService: ConfigService) {
        const key = this.configService.get<string>('YOUTUBE_API_KEY');
        if (!key) throw new Error('YOUTUBE_API_KEY not found');
        this.apiKey = key;
    }

    async proxy(endpoint: string, params: Record<string, string>) {
        const url = new URL(`${this.baseUrl}/${endpoint}`);

        Object.keys(params).forEach(key => {
            if (key !== 'endpoint') {
                url.searchParams.append(key, params[key]);
            }
        });

        url.searchParams.append('key', this.apiKey);

        try {
            const response = await fetch(url.toString());
            if (!response.ok) {
                const error = await response.json();
                throw new Error(JSON.stringify(error));
            }
            return await response.json();
        } catch (error) {
            console.error(`Error proxying to YouTube ${endpoint}:`, error);
            throw error;
        }
    }

    async proxyAction(token: string, method: string, endpoint: string, data?: any, params?: any) {
        const url = new URL(`${this.baseUrl}/${endpoint}`);

        // Append query params if any
        if (params) {
            Object.keys(params).forEach(key => {
                url.searchParams.append(key, params[key]);
            });
        }

        // We do NOT use the API Key when using OAuth token normally, 
        // but it doesn't hurt to have it unless there's a specific conflict.
        // Usually Authenticated calls rely solely on the Bearer token.
        // url.searchParams.append('key', this.apiKey); 

        try {
            const response = await fetch(url.toString(), {
                method: method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: data ? JSON.stringify(data) : undefined
            });

            if (!response.ok) {
                // Try to parse error body
                let errorBody;
                try {
                    const text = await response.text();
                    try {
                        errorBody = JSON.parse(text);
                    } catch {
                        errorBody = text;
                    }
                } catch (e) {
                    errorBody = "Could not read error body";
                }
                console.error(`Error in proxyAction for ${endpoint}:`, errorBody);
                throw new Error(JSON.stringify(errorBody) || 'YouTube API Error');
            }

            // Some actions like delete might return 204 No Content
            if (response.status === 204) {
                return { success: true };
            }

            return await response.json();
        } catch (error) {
            console.error(`Error proxying action to YouTube ${endpoint}:`, error);
            throw error;
        }
    }
}
