import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { OpenaiService } from '../openai/openai.service';
import { ShortenLinkDto, SaveLinkDto } from './utm.dto';

@Injectable()
export class UtmService {
    private readonly logger = new Logger(UtmService.name);
    private supabase: SupabaseClient;
    private readonly SHORT_IO_API_KEY: string;
    private readonly SHORT_IO_DOMAIN = "escaladae.com";
    private readonly FOLDER_TAG = "YouTube2526";
    private readonly API_URL = "https://api.short.io/links";

    constructor(
        private configService: ConfigService,
        private openaiService: OpenaiService
    ) {
        const supabaseUrl = this.configService.get<string>('UTM_SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('UTM_SUPABASE_KEY');
        this.SHORT_IO_API_KEY = this.configService.get<string>('SHORT_IO_API_KEY') || "";

        if (!supabaseUrl || !supabaseKey) {
            this.logger.error('Supabase credentials not found');
            throw new Error('Supabase credentials missing');
        }

        if (!this.SHORT_IO_API_KEY) {
            this.logger.warn('SHORT_IO_API_KEY not found in environment variables');
        }

        this.supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        });
    }

    async generateSlug(title: string): Promise<string> {
        return this.openaiService.generateSlug(title);
    }

    async shortenLink(dto: ShortenLinkDto): Promise<string> {
        if (!dto.originalURL || !dto.slug) {
            throw new Error("URL e Slug são obrigatórios");
        }

        // Extract the prefix (e.g., "yt-191125") from "yt-191125-rest-of-slug"
        const pathParts = dto.slug.split('-');
        let basePath = "";

        if (pathParts.length >= 2 && pathParts[0] === 'yt' && /^\d{6}$/.test(pathParts[1])) {
            basePath = `${pathParts[0]}-${pathParts[1]}`;
        } else {
            basePath = dto.slug.substring(0, 15);
        }

        const suffixes = ['', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];

        for (const suffix of suffixes) {
            const path = `${basePath}${suffix}`;

            try {
                const response = await fetch(this.API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': this.SHORT_IO_API_KEY,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        originalURL: dto.originalURL,
                        domain: this.SHORT_IO_DOMAIN,
                        path: path,
                        title: dto.title,
                        tags: [this.FOLDER_TAG]
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    return data.shortURL;
                }

                // Check for collision
                const errorMessage = data.error || "";
                const errorCode = data.code || "";

                const isCollision =
                    response.status === 409 ||
                    errorCode === 'link_already_exists' ||
                    (typeof errorMessage === 'string' && errorMessage.includes('already exists'));

                if (isCollision) {
                    this.logger.log(`Short.io: Path ${path} taken, trying next...`);
                    continue;
                }

                throw new Error(errorMessage || "Erro desconhecido ao encurtar link");

            } catch (error: any) {
                this.logger.warn(`Attempt for path ${path} failed:`, error);
                if (error.message && error.message.includes('already exists')) {
                    continue;
                }
                // If it's the last attempt, throw the error
                if (suffix === suffixes[suffixes.length - 1]) {
                    throw error;
                }
            }
        }
        throw new Error("Não foi possível gerar um link curto único após várias tentativas.");
    }

    async getLinks() {
        const { data, error } = await this.supabase
            .from('yt_links')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error('Error fetching links from Supabase', error);
            throw error;
        }
        return data;
    }

    async saveLink(dto: SaveLinkDto) {
        const { data, error } = await this.supabase
            .from('yt_links')
            .insert(dto)
            .select()
            .single();

        if (error) {
            this.logger.error('Error saving link to Supabase', error);
            throw error;
        }
        return data;
    }

    async deleteLink(id: string) {
        const { error } = await this.supabase
            .from('yt_links')
            .delete()
            .eq('id', id);

        if (error) {
            this.logger.error('Error deleting link from Supabase', error);
            throw error;
        }
        return { success: true };
    }
}
