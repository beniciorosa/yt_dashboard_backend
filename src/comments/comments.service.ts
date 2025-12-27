import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../openai/openai.service';
import { GeminiService } from '../gemini/gemini.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class CommentsService {
    private readonly logger = new Logger(CommentsService.name);
    private supabase: SupabaseClient;

    constructor(
        private openaiService: OpenaiService,
        private geminiService: GeminiService,
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

    async generateAiReply(commentText: string, videoTitle?: string, style: string = 'professional', authorName?: string, provider: 'openai' | 'gemini' = 'openai') {
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
            // Updated to be less "over-friendly" and more direct as requested
            case 'concise': styleInstruction = "Seja extremamente direto (max 1 frase)."; break;
            case 'friendly': styleInstruction = "Seja simpático, mas sem exageros. Emojis apenas se natural."; break;
            case 'question': styleInstruction = "Responda e engate uma pergunta relacionada."; break;
            case 'grateful': styleInstruction = "Agradeça o apoio de forma sincera e breve."; break;
            default: styleInstruction = "Seja profissional, direto e útil. Evite enrolação."; break;
        }

        const prompt = `
            Você é um criador de conteúdo do YouTube (eu, o dono do canal).
            Sua tarefa é responder a um comentário de um inscrito como SE FOSSE EU.

            CONTEXTO SOBRE MIM (IMPORTANTE):
            - Eu uso gírias moderadas como "Tmj, mano!", "Valeu demais!", "Fala [Nome], beleza?".
            - Eu sou atencioso, mas natural. Não pareço um robô corporativo.
            - Eu cito o nome da pessoa sempre que possível no início, se o nome for legível.
            
            
            NOME DO INSCRITO: "${authorName || 'Desconhecido'}"
            (SEMPRE trate o nome do inscrito:
             1. Se for um handle (@nome), remova o '@'.
             2. Remova números do final (ex: 'joao123' -> 'Joao').
             3. Pegue APENAS o primeiro nome e Capitalize. (ex: 'rosangelastefanello6710' -> 'Rosangela').
             4. Se o nome resultante for estranho ou ininteligível, não use o nome.
             5. Se for um nome comum, comece com "Fala [NomeLimpo], ...")

            ${examples ? `Abaixo estão exemplos REAIS de como eu respondo. COPIE MEU TOM E ESTILO:\n${examples}\n\nAgora, responda este novo comentário seguindo o mesmo estilo:` : "Responda de forma natural e engajada."}

            NOVO COMENTÁRIO: "${commentText}"
            TÍTULO DO VÍDEO: "${videoTitle || 'N/A'}"
            
            INSTRUÇÃO DE ESTILO ADICIONAL: ${styleInstruction}
            
            REGRAS:
            - Responda apenas com o texto da resposta.
            - Máximo 2-3 frases.
            - Tente iniciar com o nome da pessoa se fizer sentido (ex: "Fala Jonas, ...").
        `;

        let providerPrompt = prompt;
        if (provider === 'gemini') {
            providerPrompt += `
                INSTRUÇÃO ADICIONAL PARA GEMINI:
                - Use sua capacidade de raciocínio profundo (Thinking).
                - ATENÇÃO AO SUBTEXTO: Identifique se o inscrito expressa uma intenção de ajuda, gratidão ou dúvida emocional. Reconheça e valide isso no início da resposta antes de ser técnico.
                - Seja mais detalhista, técnico e forneça contexto estratégico nas respostas.
                - Não se limite a 2 frases se a pergunta exigir uma explicação técnica melhor. 
                - Siga exatamente os exemplos de tom de voz, mas com a profundidade de um mentor experiente e empático.
                - FORMATAÇÃO: NÃO use negrito ou asteriscos (**) em nenhuma parte do texto.
                - EMOJIS: Caso decida usar um emoji no final, alterne de forma natural entre o foguete (🚀) e a montanha Fuji (🗻).
            `;
        }

        try {
            if (provider === 'gemini') {
                return await this.geminiService.generateThinking(providerPrompt);
            }
            return await this.openaiService.generateText(prompt);
        } catch (error: any) {
            this.logger.error('Error generating AI reply', error);
            throw new HttpException(`Failed to generate reply: ${error.message || error}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async learnReply(commentText: string, replyText: string, username?: string) {
        if (!commentText || !replyText) return;

        const { error } = await this.supabase
            .from('reply_examples')
            .insert([{
                comment_text: commentText,
                reply_text: replyText,
                username: username
            }]);

        if (error) {
            this.logger.error('Error saving reply example for learning', error);
        }
    }

    async getInteractionCount(username: string): Promise<number> {
        if (!username) return 0;

        const { count, error } = await this.supabase
            .from('reply_examples')
            .select('*', { count: 'exact', head: true })
            .eq('username', username);

        if (error) {
            this.logger.error(`Error counting interactions for ${username}`, error);
            return 0;
        }
        return count || 0;
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

    async getTopCommenters(limit: number = 5) {
        // Since Supabase JS client doesn't support GROUP BY directly, 
        // we can use a raw select if we have a view or rpc, 
        // but for a simple "top 5" in a small/medium table, 
        // fetching all unique usernames and their counts is feasible 
        // OR we can use the 'count' feature with 'select' in a loop if usernames were known.
        // BETTER: Using a direct select with aggregation.

        const { data, error } = await this.supabase
            .from('reply_examples')
            .select('username')

        if (error) {
            this.logger.error('Error fetching top commenters', error);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const counts: Record<string, number> = {};
        (data || []).forEach(r => {
            if (r.username) {
                counts[r.username] = (counts[r.username] || 0) + 1;
            }
        });

        return Object.entries(counts)
            .map(([username, count]) => ({ username, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    async getUserHistory(username: string) {
        const { data, error } = await this.supabase
            .from('reply_examples')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false });

        if (error) {
            this.logger.error(`Error fetching history for ${username}`, error);
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return data;
    }

    async toggleFavorite(commentData: any) {
        const { comment_id } = commentData;

        // Check if already favorited
        const { data: existing } = await this.supabase
            .from('comment_favorites')
            .select('comment_id')
            .eq('comment_id', comment_id)
            .single();

        if (existing) {
            // Remove
            const { error } = await this.supabase
                .from('comment_favorites')
                .delete()
                .eq('comment_id', comment_id);

            if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
            return { favorited: false };
        } else {
            // Add
            const { error } = await this.supabase
                .from('comment_favorites')
                .insert([{
                    comment_id: comment_id,
                    author_name: commentData.author_name,
                    author_profile_image: commentData.author_profile_image,
                    content: commentData.content,
                    video_id: commentData.video_id,
                    video_title: commentData.video_title
                }]);

            if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
            return { favorited: true };
        }
    }

    async getFavorites() {
        const { data, error } = await this.supabase
            .from('comment_favorites')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        return data;
    }
}
