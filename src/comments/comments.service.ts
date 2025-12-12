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

    async generateAiReply(commentText: string, videoTitle?: string, style: string = 'professional', authorName?: string) {
        // 1. Fetch recent examples to learn tone
        let examples = "";
        try {
            const { data: recentReplies } = await this.supabase
                .from('reply_examples')
                .select('comment_text, reply_text')
                .order('created_at', { ascending: false })
                .limit(50); // Increased limit as requested

            if (recentReplies && recentReplies.length > 0) {
                examples = "Exemplos do meu estilo de resposta:\n" +
                    recentReplies.map(r => `Comentário: "${r.comment_text}"\nMinha Resposta: "${r.reply_text}"`).join("\n---\n");
            }
        } catch (e) {
            this.logger.warn("Could not fetch reply examples for few-shot learning", e);
        }

        let styleInstruction = "";
        switch (style) {
            case 'concise': styleInstruction = "Seja direto, curto e objetivo."; break;
            case 'friendly': styleInstruction = "Seja muito amigável, use emojis e mostre entusiasmo."; break;
            case 'question': styleInstruction = "Agradeça e termine com uma pergunta para engajar."; break;
            case 'grateful': styleInstruction = "Foque em agradecer o apoio e carinho."; break;
            default: styleInstruction = "Seja profissional, polido e útil."; break;
        }

        const prompt = `
            Você é um criador de conteúdo do YouTube (eu, o dono do canal).
            Sua tarefa é responder a um comentário de um inscrito como SE FOSSE EU.

            CONTEXTO SOBRE MIM (IMPORTANTE):
            - Eu uso gírias moderadas como "Tmj, mano!", "Valeu demais!", "Fala [Nome], beleza?".
            - Eu sou atencioso, mas natural. Não pareço um robô corporativo.
            - Eu cito o nome da pessoa sempre que possível no início, se o nome for legível.
            
            NOME DO INSCRITO: "${authorName || 'Desconhecido'}"
            (Se o nome for 'Desconhecido' ou ilemgrama, não use o nome. Se for um nome comum, comece com "Fala ${authorName || ''}, ...")

            ${examples ? `Abaixo estão exemplos REAIS de como eu respondo. COPIE MEU TOM E ESTILO:\n${examples}\n\nAgora, responda este novo comentário seguindo o mesmo estilo:` : "Responda de forma natural e engajada."}

            NOVO COMENTÁRIO: "${commentText}"
            TÍTULO DO VÍDEO: "${videoTitle || 'N/A'}"
            
            INSTRUÇÃO DE ESTILO ADICIONAL: ${styleInstruction}
            
            REGRAS:
            - Responda apenas com o texto da resposta.
            - Máximo 2-3 frases.
            - Tente iniciar com o nome da pessoa se fizer sentido (ex: "Fala Jonas, ...").
        `;

        try {
            return await this.openaiService.generateText(prompt);
        } catch (error) {
            this.logger.error('Error generating AI reply', error);
            throw new HttpException('Failed to generate reply', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async learnReply(commentText: string, replyText: string) {
        if (!commentText || !replyText) return;

        const { error } = await this.supabase
            .from('reply_examples')
            .insert([{ comment_text: commentText, reply_text: replyText }]);

        if (error) {
            this.logger.error('Error saving reply example for learning', error);
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
