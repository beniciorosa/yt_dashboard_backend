import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../openai/openai.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class CommentsService {
    private readonly logger = new Logger(CommentsService.name);
    private supabase: SupabaseClient;

    constructor(
        private openaiService: OpenaiService,
        private configService: ConfigService
    ) {
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

        if (!supabaseUrl || !supabaseKey) {
            this.logger.error('Supabase credentials not found');
            throw new Error('Supabase credentials missing');
        }

        this.supabase = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false }
        });
    }

    async generateAiReply(commentText: string, videoTitle?: string, style: string = 'professional') {
        // Construct a prompt based on the user's style preference
        // styles: 'concise', 'friendly', 'question', 'grateful'

        let styleInstruction = "";
        switch (style) {
            case 'concise': styleInstruction = "Seja direto, curto e objetivo."; break;
            case 'friendly': styleInstruction = "Seja muito amigável, use emojis e mostre entusiasmo."; break;
            case 'question': styleInstruction = "Agradeça e termine com uma pergunta para engajar."; break;
            case 'grateful': styleInstruction = "Foque em agradecer o apoio e carinho."; break;
            default: styleInstruction = "Seja profissional, polido e útil."; break;
        }

        const prompt = `
            Você é um criador de conteúdo do YouTube respondendo comentários.
            
            Contexto:
            - Comentário do inscrito: "${commentText}"
            - Título do Vídeo (se houver): "${videoTitle || 'N/A'}"
            
            Sua tarefa:
            - Escreva uma resposta em Português (Brasil).
            - Estilo: ${styleInstruction}
            - Evite ser repetitivo.
            - Resposta curta (máximo 2-3 frases).
            
            Responda apenas com o texto da resposta.
        `;

        try {
            // We use the OpenAI service directly. Assuming it exposes the client or a method we can reuse.
            // Since OpenaiService has a specific 'generateEmail' method, we might need to use its internal client if public, 
            // or add a generic method. 
            // Checking OpenaiService... it has a private 'openai' client. 
            // We should ideally add a generic 'chatCompletion' method to OpenaiService, but for now let's hack it 
            // or assume we can add it. 
            // Actually, let's look at OpenaiService again. It has generateEmail, generateDescription, transcribeAudio, generateSlug. 
            // None are generic. I will add a generic text generation method to OpenaiService later. 
            // For now, I will use a direct call if I can access the client, OR I will modify OpenaiService.
            // Let's modify OpenaiService first to keep it clean.

            // Wait, I can't modify OpenaiService in this tool call. 
            // I'll assume usage of a new method 'generateText' that I will add in the next step.
            return await this.openaiService.generateText(prompt);

        } catch (error) {
            this.logger.error('Error generating AI reply', error);
            throw new HttpException('Failed to generate reply', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async getQuickReplies() {
        const { data, error } = await this.supabase
            .from('quick_replies')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error('Error fetching quick replies', error);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
    }

    async saveQuickReply(title: string, text: string) {
        const { data, error } = await this.supabase
            .from('quick_replies')
            .insert([{ title, text }])
            .select();

        if (error) {
            this.logger.error('Error saving quick reply', error);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return data;
    }

    async deleteQuickReply(id: string) {
        const { error } = await this.supabase
            .from('quick_replies')
            .delete()
            .eq('id', id);

        if (error) {
            this.logger.error('Error deleting quick reply', error);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
        return { success: true };
    }
}
