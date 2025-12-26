import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import { OpenaiService } from '../openai/openai.service';

@Injectable()
export class GeniusService {
    private readonly logger = new Logger(GeniusService.name);
    private supabase: SupabaseClient;

    constructor(
        private configService: ConfigService,
        private openaiService: OpenaiService
    ) {
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
        this.supabase = createClient(supabaseUrl!, supabaseKey!);
    }

    async generateVideoIdeasFromComments() {
        try {
            // 1. Fetch comments from reply_examples
            const { data: comments, error } = await this.supabase
                .from('reply_examples')
                .select('comment_text')
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (!comments || comments.length === 0) {
                return {
                    ideas: "Ainda não há dados suficientes no banco para analisar. Comece a responder comentários para alimentar o Genius!",
                    thinking: ""
                };
            }

            const commentsJoined = comments.map(c => `- ${c.comment_text}`).join('\n');

            const prompt = `
        Você é um analista sênior de dados e estrategista de conteúdo para YouTube (GENIUS).
        Sua tarefa é analisar o histórico COMPLETO de perguntas e comentários dos inscritos para identificar:
        1. Padrões de dúvidas recorrentes.
        2. Dores ou problemas que os inscritos estão enfrentando.
        3. Oportunidades de novos vídeos que resolveriam essas dores.

        Abaixo está o banco completo de interações:
        ${commentsJoined}

        INSTRUÇÕES:
        - Analise profundamente o contexto de todos os dados fornecidos.
        - Sugira 3 ideias de vídeos altamente clicáveis e úteis baseadas nas tendências de todo o histórico.
        - Explique o PORQUÊ de cada ideia com base nos dados.
        - Retorne a resposta em formato Markdown organizado e elegante.
        - Use emojis para tornar a leitura agradável.
        - Responda em Português do Brasil.
        - Não mencione que você é um modelo de linguagem, apenas apresente os insights.
      `;

            const response = await this.openaiService.generateText(prompt);

            return {
                ideas: response,
                thinking: "Análise processada via GPT-5.2 Pro (Flagship)"
            };
        } catch (error) {
            this.logger.error('Error in generateVideoIdeasFromComments', error);
            throw new HttpException('Falha ao gerar insights do Genius', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
