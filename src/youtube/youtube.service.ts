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

        console.log(`[ProxyAction] ${method} ${url.toString()}`);

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        };

        const hasBody = data !== undefined && data !== null && method !== 'GET' && method !== 'HEAD';

        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        } else if (method === 'POST') {
            // Essential for endpoints like comments/rate that are POST but empty body
            headers['Content-Length'] = '0';
        }

        console.log(`[ProxyAction] ${method} ${url.toString()} | HasBody: ${hasBody}`);

        try {
            const response = await fetch(url.toString(), {
                method: method,
                headers: headers,
                body: hasBody ? JSON.stringify(data) : undefined
            });

            const status = response.status;
            console.log(`[ProxyAction] Status: ${status}`);

            // 1. Safely read body ONCE
            const rawBody = await response.text();

            // 2. Try parse JSON
            let jsonBody;
            try {
                jsonBody = rawBody ? JSON.parse(rawBody) : null;
            } catch {
                jsonBody = rawBody; // Fallback to text
            }

            if (!response.ok) {
                console.error(`[ProxyAction] Upstream Error (${status}):`, rawBody);
                throw new Error(JSON.stringify(jsonBody) || `YouTube API Error ${status}`);
            }

            if (status === 204) {
                return { success: true };
            }

            return jsonBody || { success: true };

        } catch (error) {
            console.error(`Error proxying action to YouTube ${endpoint}:`, error);
            throw error;
        }
    }
}
