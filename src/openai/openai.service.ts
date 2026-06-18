import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class OpenaiService {
    private openai: OpenAI;

    constructor(private configService: ConfigService) {
        let apiKey = this.configService.get<string>('OPENAI_API_KEY');

        if (!apiKey) {
            console.warn('OPENAI_API_KEY not found in environment variables');
        } else {
            apiKey = apiKey.trim();
            console.log('--- OpenAI Configuration ---');
            console.log(`OpenAI API Key loaded successfully. Length: ${apiKey.length}`);
            console.log(`Starts with: ${apiKey.substring(0, 7)}...`);
            console.log('---------------------------');
        }

        this.openai = new OpenAI({
            apiKey: apiKey,
        });
    }

    async generateEmail(videoTitle: string, videoDescription: string, videoUrl: string) {
        const prompt = `
            Você é um especialista em Email Marketing e Copywriting.
            Sua tarefa é criar um e-mail curto, persuasivo e que gere desejo para convidar a lista de contatos a assistir um novo vídeo no YouTube.

            Título do Vídeo: "${videoTitle}"
            Descrição do Vídeo: "${videoDescription}"
            Link do Vídeo: "${videoUrl}"

            Regras:
            1. O e-mail deve ser pessoal, como se fosse escrito pelo criador do canal.
            2. O objetivo é o clique no link.
            3. Gere um Assunto (Subject) altamente clicável (curiosidade, benefício ou urgência).
            4. O Corpo (Body) deve ter no máximo 3 parágrafos curtos.
            5. Inclua o Link do Vídeo de forma clara no corpo do email (pode ser em um botão ou texto linkado, mas aqui retorne apenas o texto com a URL).
            6. Use tags HTML simples para formatação se necessário (ex: <br>, <b>), mas mantenha limpo.

            Responda APENAS um JSON com o formato:
            {
                "subject": "Assunto do Email",
                "body": "Corpo do Email em HTML"
            }
        `;

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'system', content: 'Você é um assistente útil que gera JSON.' },
                    { role: 'user', content: prompt },
                ],
                model: 'gpt-4o',
                response_format: { type: 'json_object' },
            });

            const content = completion.choices[0].message.content;
            if (!content) throw new Error('Resposta vazia da OpenAI.');

            return JSON.parse(content);
        } catch (error) {
            console.error('Error generating email with OpenAI:', error);
            throw new Error('Failed to generate email');
        }
    }

    async generateDescription(transcriptionText: string, videoTitle: string) {
        // Helper to extract last timestamp
        const getLastTimestamp = (srtText: string): string => {
            try {
                const timeRegex = /(\d{2}:\d{2}:\d{2})/g;
                const matches = srtText.match(timeRegex);
                if (matches && matches.length > 0) {
                    return matches[matches.length - 1];
                }
            } catch (e) { }
            return "Desconhecido";
        };

        const lastTime = getLastTimestamp(transcriptionText);

        const prompt = `
      Você é um especialista em SEO para YouTube e Copywriting.
      Sua tarefa é analisar a TRANSCRIÇÃO (em formato SRT/Legenda com timestamps) fornecida e criar componentes de texto para uma descrição de vídeo de alta performance.
      
      O Título do vídeo é: "${videoTitle}"
      DURAÇÃO ESTIMADA DO VÍDEO (Baseado no SRT): ${lastTime}

      Gere uma saída JSON com exatamente 5 campos: "intro", "chapters", "hashtags", "description_rationale", "chapters_rationale".
      
      Regras para "intro":
      1. Escreva entre 2 a 3 parágrafos curtos e envolventes resumindo o conteúdo do vídeo, sempre em primeira pessoa.
      2. O PRIMEIRO parágrafo é vital para o ALGORITMO (CTR e Retenção). Ele deve:
         - Conter as palavras-chave do título.
         - Gerar curiosidade imediata (Loop Aberto).
         - Prometer um benefício claro para quem assistir até o fim.
      3. Use tom conversacional, persuasivo e magnético. Evite linguagem robótica.
      
      Regras CRÍTICAS para "chapters" (EVITE ALUCINAÇÕES):
      1. USE OS TIMESTAMPS EXATOS DO SRT. NÃO ARREDONDE. Se o SRT diz "04:12", use "04:12".
      2. O vídeo termina em ${lastTime}. NENHUM capítulo pode passar desse tempo.
      3. Crie capítulos baseados em RETENÇÃO: Identifique os momentos de "virada" ou "picos de interesse" no conteúdo.
      4. Formato EXATO: "MM:SS – Título Magnético".
         - Títulos de capítulos devem gerar curiosidade (ex: "O Segredo de R$10k" em vez de "Faturamento").
      5. Mínimo 3 capítulos, Máximo 8 (dependendo da duração).
      
      Regras para "hashtags":
      1. Exatamente 3 hashtags de alta busca no nicho.
      2. FORMATO OBRIGATÓRIO: Separadas apenas por ESPAÇO. NÃO use vírgulas. Exemplo: #Tag1 #Tag2 #Tag3
      
      Regras para "description_rationale" e "chapters_rationale" (THINKING PROCESS):
      1. "description_rationale": Explique COMO a descrição criada atende ao Algoritmo do YouTube.
         - Cite gatilhos de retenção usados.
         - Explique o uso de palavras-chave para SEO.
         - Justifique o tom de voz escolhido para maximizar cliques.
      2. "chapters_rationale": Explique a estratégia de segmentação.
         - Por que escolheu esses pontos de corte?
         - Como os títulos dos capítulos ajudam na navegação e retenção do usuário?
         - Mostre que você entendeu a estrutura narrativa do vídeo.
      3. Seja profundo e analítico, como um estrategista de YouTube Senior.
      
      Responda APENAS o JSON.
      
      TRANSCRIÇÃO SRT:
      ${transcriptionText.substring(0, 100000)} 
    `;

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'system', content: 'Você é um assistente útil que gera JSON.' },
                    { role: 'user', content: prompt }
                ],
                model: 'gpt-4o',
                response_format: { type: 'json_object' }
            });

            const content = completion.choices[0].message.content;
            if (!content) throw new Error("Resposta vazia da OpenAI.");

            const jsonResponse = JSON.parse(content);

            // Post-processing logic (copied from frontend)
            let chaptersArray: string[] = [];
            if (Array.isArray(jsonResponse.chapters)) {
                chaptersArray = jsonResponse.chapters;
            } else if (typeof jsonResponse.chapters === 'string') {
                chaptersArray = jsonResponse.chapters.split('\n');
            }

            const formattedChapters = chaptersArray.map(chapter => {
                const timeMatch = chapter.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s?[-–]\s?(.*)/);
                if (timeMatch) {
                    let part1 = timeMatch[1];
                    let part2 = timeMatch[2];
                    let part3 = timeMatch[3];
                    let text = timeMatch[4];
                    if (part3) {
                        return `${part2.padStart(2, '0')}:${part3.padStart(2, '0')} – ${text}`;
                    }
                    return `${part1.padStart(2, '0')}:${part2.padStart(2, '0')} – ${text}`;
                }
                return chapter;
            });

            const cleanChapters: string[] = [];
            let lastSeconds = -100;

            formattedChapters.forEach(chapter => {
                const timeMatch = chapter.match(/^(\d{2}):(\d{2})/);
                if (timeMatch) {
                    const currentSeconds = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
                    if (currentSeconds === 0) {
                        cleanChapters.push(chapter);
                        lastSeconds = 0;
                        return;
                    }
                    if (currentSeconds - lastSeconds > 10) {
                        cleanChapters.push(chapter);
                        lastSeconds = currentSeconds;
                    }
                } else {
                    cleanChapters.push(chapter);
                }
            });

            return {
                intro: Array.isArray(jsonResponse.intro) ? jsonResponse.intro.join('\n\n') : (jsonResponse.intro || ""),
                chapters: cleanChapters,
                hashtags: (jsonResponse.hashtags || "").replace(/,/g, ' ').replace(/\s+/g, ' ').trim(),
                description_rationale: jsonResponse.description_rationale || "Sem racional gerado.",
                chapters_rationale: jsonResponse.chapters_rationale || "Sem racional gerado."
            };

        } catch (error) {
            console.error("Error generating description with OpenAI:", error);
            throw new Error("Failed to generate description");
        }
    }

    async transcribeAudio(fileUrl: string) {
        try {
            if (!fileUrl) {
                throw new HttpException('No file URL provided', HttpStatus.BAD_REQUEST);
            }

            console.log(`Downloading file from URL: ${fileUrl}`);

            // Download file from Supabase Storage URL
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Failed to download file: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Extract filename from URL or use default
            const urlObj = new URL(fileUrl);
            const pathname = urlObj.pathname;
            const originalName = pathname.split('/').pop() || 'audio.mp3';

            console.log(`Transcribing file: ${originalName}, size: ${buffer.length} bytes`);

            const transcription = await this.openai.audio.transcriptions.create({
                file: await import('openai/uploads').then(m => m.toFile(buffer, originalName)),
                model: 'whisper-1',
                language: 'pt',
                response_format: 'srt',
            });

            return transcription;
        } catch (error: any) {
            console.error("Error transcribing audio with OpenAI:", error);
            // Throw the actual error message so the frontend can see it
            throw new HttpException(`Failed to transcribe audio: ${error.message || error}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /** Transcreve um buffer de áudio (fallback Whisper do Cross-View). Retorna SRT. */
    async transcribeBuffer(buffer: Buffer, filename = 'audio.m4a'): Promise<string> {
        const { toFile } = await import('openai/uploads');
        const transcription = await this.openai.audio.transcriptions.create({
            file: await toFile(buffer, filename),
            model: 'whisper-1',
            language: 'pt',
            response_format: 'srt',
        });
        return transcription as unknown as string;
    }

    async generateSlug(title: string): Promise<string> {
        const prompt = `
            Role: SEO Expert for YouTube.
            Task: Create a concise URL slug using the FIRST keyword(s) of the video title.
            
            STRICT RULES:
            1. Keywords: ALWAYS use the primary keywords from the START of the title. Do not invent synonyms.
            2. "Mercado Livre": If the title contains "Mercado Livre", ALWAYS replace it with the word "meli".
            3. Length: Use exactly 2 or 3 words.
            4. Stop words: Remove prepositions and common small words (pt-BR: a, o, de, da, do, pra, no, na, com, sem, para, em).
            5. Format: lowercase-words-separated-by-hyphens.
            6. No Dates: Do NOT include numbers related to dates.
            7. Output: Return ONLY the slug string. No markdown, no quotes, no explanations.

            Input Title: "${title}"
            Output Slug:
        `;

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that generates slugs.' },
                    { role: 'user', content: prompt },
                ],
                model: 'gpt-4o', // Reverted from gpt-5.2-pro for stability
                max_tokens: 50,
                temperature: 0.2,
            });

            let text = completion.choices[0].message.content || "";

            // Clean up potential markdown code blocks or quotes
            text = text.replace(/```/g, '').replace(/`/g, '').replace(/"/g, '').replace(/'/g, '').trim();

            // Ensure it looks like a slug
            if (text.includes(' ')) {
                text = text.split(/\s+/).join('-');
            }

            return text;
        } catch (error) {
            console.error("Error generating slug with OpenAI:", error);
            throw new Error("Failed to generate slug");
        }
    }

    async generateText(prompt: string, model?: string): Promise<string> {
        const targetModel = model || 'gpt-5.2-pro';

        try {
            // Specialized handling for GPT-5 flagship models which require the Responses API
            if (targetModel.startsWith('gpt-5') && targetModel.includes('pro')) {
                const response = await (this.openai as any).responses.create({
                    model: targetModel,
                    input: [
                        {
                            role: 'user',
                            content: [{ type: 'input_text', text: prompt }]
                        }
                    ],
                    reasoning: {
                        effort: 'high' // Lowered from xhigh to stay under Vercel's 300s timeout
                    }
                });

                // Extraction from Responses API (GPT-5 series)
                // Priority 1: Top-level output_text
                if (response.output_text) return response.output_text;

                // Priority 2: Full content search in output items
                const outputItems = response.output || [];
                for (const item of outputItems) {
                    if (item.type === 'message' && item.content) {
                        const textItem = item.content.find((c: any) => c.type === 'output_text');
                        if (textItem?.text) return textItem.text;
                    }
                }

                // Fallback for different response item types
                for (const item of outputItems) {
                    if (item.text) return item.text;
                    if (item.content && typeof item.content === 'string') return item.content;
                }

                console.warn(`GPT-5 Pro (${targetModel}): Could not extract text from response. Structure:`, JSON.stringify(response));
                return "";
            }

            // Standard Chat Completions for other models (gpt-4o, etc.)
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: prompt }
                ],
                model: targetModel,
            });

            return completion.choices[0].message.content || "";
        } catch (error) {
            console.error(`Error generating text with OpenAI (${targetModel}):`, error);
            throw new Error(`Failed to generate text with ${targetModel}`);
        }
    }
    async analyzeCompetitorGrowth(data: any) {
        const { competitorStats, topVideos, recentVideos, myChannelStats, isMyChannel } = data;

        const roleDescription = isMyChannel
            ? "Você é um CONSULTOR DE YOUTUBE DE ELITE contratado para auditar este canal CRITICAMENTE."
            : "Você é um ESPIÃO E ESTRATEGISTA DE YOUTUBE focado em Engenharia Reversa de concorrentes.";

        const prompt = `
            ${roleDescription}
            
            OBJETIVO:
            Criar um relatório de inteligência estratégico e acionável. Não use clichês. Quero insights profundos baseados nos dados.

            DADOS DO CANAL ALVO:
            - Nome: ${competitorStats.channelName}
            - Inscritos: ${competitorStats.subscriberCount}
            - Views Totais: ${competitorStats.viewCount}
            - Vídeos: ${competitorStats.videoCount}
            ${myChannelStats ? `- MEU CANAL (Para Comparação): ${myChannelStats.channelName} (${myChannelStats.subscriberCount} subs)` : ''}

            TOP VÍDEOS (O que funciona):
            ${JSON.stringify(topVideos.slice(0, 5), null, 2)}

            VÍDEOS RECENTES (O que estão testando):
            ${JSON.stringify(recentVideos.slice(0, 5), null, 2)}

            INSTRUÇÕES DE ANÁLISE (THINKING PROCESS):
            1.  **Padrões de Sucesso:** Analise os Top Vídeos. O que eles têm em comum? (Títulos, Temas, Thumbnails implícitas, Duração).
            2.  **Análise de Outliers:** Identifique vídeos recentes que performaram muito acima da média (se houver). Por que explodiram?
            3.  **Engenharia Reversa (Se Competidor):** O que esse canal faz que eu DEVERIA copiar ou adaptar? Onde estão as brechas que ele não atende?
            4.  **Auditoria Crítica (Se Meu Canal):** O que está matando a retenção ou o clique? O que eu preciso parar de fazer imediatamente?

            FORMATO DE SAÍDA (MARKDOWN):
            
            ## 📊 Diagnóstico Estratégico: [Nome do Canal]
            
            ### 🏆 O Que Está Funcionando (Padrões de Viralidade)
            *   **Temas Vencedores:** [Análise dos Top Vídeos]
            *   **Estrutura de Títulos:** [Padrões de Copywriting detectados]
            *   **Fator X:** [O diferencial único deste canal]

            ### 🚀 Oportunidades & Brechas
            *   [Insight 1]
            *   [Insight 2]
            
            ### 💡 Plano de Ação Imediato
            1.  **Ação 1:** [O que fazer]
            2.  **Ação 2:** [O que fazer]
            3.  **Ação 3:** [O que fazer]

            (Seja direto, use negrito para ênfase, sem enrolação. Fale como um estrategista sênior.)
        `;

        try {
            console.log("Starting AI Analysis with o1-preview...");
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'user', content: prompt }
                ],
                model: 'o1-preview',
            });

            return completion.choices[0].message.content || "";
        } catch (error: any) {
            console.warn("o1-preview failed or not available, falling back to gpt-4o. Error:", error.message);
            // Fallback to GPT-4o
            try {
                const completion = await this.openai.chat.completions.create({
                    messages: [
                        { role: 'system', content: "Você é um especialista em YouTube." },
                        { role: 'user', content: prompt }
                    ],
                    model: 'gpt-4o',
                });
                return completion.choices[0].message.content || "";
            } catch (fallbackError) {
                console.error("Error generating analysis with OpenAI:", fallbackError);
                throw new Error("Failed to generate analysis");
            }
        }
    }

    // ===================== CROSS-VIEW (análise cruzada de vídeos) =====================

    /** Lista os ids de modelos disponíveis na chave atual (para o seletor de modelo). */
    async listModelIds(): Promise<string[]> {
        try {
            const list = await this.openai.models.list();
            return (list.data || []).map((m: any) => m.id);
        } catch (error: any) {
            console.error('Erro ao listar modelos da OpenAI:', error?.message || error);
            return [];
        }
    }

    /** Lê uma thumbnail (visão) e devolve um descritor estruturado. Sempre usa gpt-4o. */
    async describeThumbnail(imageUrl: string): Promise<any> {
        if (!imageUrl) return null;
        try {
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'Você analisa thumbnails de vídeos do YouTube e responde APENAS JSON.' },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text:
                                    'Analise esta thumbnail de um vídeo do YouTube. Responda só um JSON com os campos: ' +
                                    '"texto_na_imagem" (todo texto visível, string), "tem_rosto" (boolean), "emocao" (string), ' +
                                    '"promessa_visual" (o que a imagem promete, string), "estilo" (string), ' +
                                    '"cores_dominantes" (array de strings), "gatilhos" (array de gatilhos de clique).',
                            },
                            { type: 'image_url', image_url: { url: imageUrl } },
                        ] as any,
                    },
                ],
            });
            const content = completion.choices[0].message.content;
            return content ? JSON.parse(content) : null;
        } catch (error: any) {
            console.error('Erro em describeThumbnail:', error?.message || error);
            return null;
        }
    }

    /** Gera um "fingerprint" estruturado do conteúdo do vídeo (texto). */
    async fingerprintVideo(
        input: { title?: string; description?: string; transcript?: string },
        model = 'gpt-4o',
    ): Promise<any> {
        const transcript = (input.transcript || '').substring(0, 24000);
        const description = (input.description || '').substring(0, 4000);
        const prompt =
            `Você é um estrategista sênior de YouTube. Analise o conteúdo abaixo e extraia um "fingerprint" do vídeo.\n\n` +
            `TÍTULO: ${input.title || '(sem título)'}\n` +
            `DESCRIÇÃO: ${description || '(sem descrição)'}\n` +
            `TRANSCRIÇÃO (pode estar truncada):\n${transcript || '(sem transcrição disponível)'}\n\n` +
            `Responda APENAS um JSON com os campos:\n` +
            `"hook" (como o vídeo abre / promessa inicial),\n` +
            `"promessa" (a promessa central do vídeo),\n` +
            `"topicos" (array dos principais assuntos),\n` +
            `"sinais_de_nivel" (pistas de que o conteúdo é para público iniciante, intermediário ou avançado — explique),\n` +
            `"estrutura" (como o conteúdo é estruturado),\n` +
            `"cta" (qual chamada para ação aparece, se houver),\n` +
            `"tom" (tom de voz),\n` +
            `"palavras_chave" (array).`;
        try {
            const completion = await this.openai.chat.completions.create({
                model,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'Você é um estrategista de YouTube e responde APENAS JSON.' },
                    { role: 'user', content: prompt },
                ],
            });
            const content = completion.choices[0].message.content;
            return content ? JSON.parse(content) : null;
        } catch (error: any) {
            console.error('Erro em fingerprintVideo:', error?.message || error);
            return null;
        }
    }

    private safeParseJson(text: string): any {
        if (!text) return null;
        let t = text.trim();
        t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        try {
            return JSON.parse(t);
        } catch {
            const start = t.indexOf('{');
            const end = t.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(t.substring(start, end + 1));
                } catch {
                    /* noop */
                }
            }
            return { _parseError: true, raw: text.substring(0, 2000) };
        }
    }

    private buildCrossAnalysisPrompt(videos: any[]): string {
        const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const blocks = videos
            .map((v, i) => {
                const s = v.salesFacts || {};
                const fp = v.fingerprint ? JSON.stringify(v.fingerprint) : '(sem fingerprint)';
                const th = v.thumbDescriptor ? JSON.stringify(v.thumbDescriptor) : '(sem leitura de thumbnail)';
                const transcript = (v.transcript || '').substring(0, 8000);
                return (
                    `### VÍDEO ${i + 1} — id=${v.videoId}\n` +
                    `Título: ${v.title || ''}\n` +
                    `Descrição (trunc): ${(v.description || '').substring(0, 1500)}\n` +
                    `FATOS DE VENDA (all-time, atribuídos por UTM): leads=${s.leads ?? 0}, vendas=${s.won ?? 0}, ` +
                    `receita=R$ ${brl(s.revenue ?? 0)}, ticket_medio=R$ ${brl(s.ticketMedio ?? 0)}, conversao=${(s.conversionRate ?? 0).toFixed(1)}%\n` +
                    `Mix de produtos: ${(s.productMix || []).map((p: any) => `${p.name} (${p.count})`).join(', ') || '(nenhum)'}\n` +
                    `Fingerprint do conteúdo: ${fp}\n` +
                    `Leitura da thumbnail: ${th}\n` +
                    `Transcrição (trunc): ${transcript || '(sem transcrição)'}\n`
                );
            })
            .join('\n');

        return (
            `Você vai comparar ${videos.length} vídeos de um mesmo canal para descobrir POR QUE alguns convertem muito mais que outros (em leads E em vendas reais), e traçar o PERFIL DE PÚBLICO de cada um.\n\n` +
            `Dados de cada vídeo:\n\n${blocks}\n\n` +
            `INSTRUÇÕES:\n` +
            `- Use os FATOS DE VENDA como verdade. Não invente números.\n` +
            `- Para o perfil de público (iniciante / intermediário / avançado), INFIRA a partir do ticket médio, do volume de vendas e do mix de produtos + o conteúdo. NÃO use faixas fixas; justifique com base nos dados.\n` +
            `- Identifique os fatores de conteúdo (hook, título, thumbnail, profundidade, CTA, tema) que separam os que mais venderam dos que menos venderam.\n\n` +
            `Responda APENAS um JSON com este formato exato:\n` +
            `{\n` +
            `  "perVideo": [{ "videoId": string, "audienceProfile": { "tier": string, "justificativa": string }, "ticketMedio": number, "leads": number, "won": number, "revenue": number, "productMix": [{"name": string, "count": number}], "conversionDrivers": { "hook": string, "titulo": string, "thumbnail": string, "profundidade": string, "cta": string }, "porqueConverteuOuNao": string }],\n` +
            `  "crossInsights": { "fatoresDeConversao": [{ "fator": string, "explicacao": string, "evidencia": string }], "padroesDeTitulo": string, "padroesDeThumbnail": string, "padroesDeConteudo": string, "audienceSegmentMap": [{ "segmento": string, "videoIds": [string] }], "productAffinity": [{ "produto": string, "tipoDeConteudo": string }], "recommendations": [string] }\n` +
            `}`
        );
    }

    /** Análise cruzada dos vídeos selecionados. Robusta a modelos exigentes; faz fallback p/ gpt-4o. */
    async crossAnalyze(payload: { videos: any[]; model: string }): Promise<{ result: any; usage: any; modelUsed: string }> {
        const system =
            'Você é um consultor de elite de YouTube e de vendas. Cruza conteúdo de vídeos com resultados reais de venda e responde APENAS JSON, sem texto fora do JSON.';
        const user = this.buildCrossAnalysisPrompt(payload.videos);

        // Modelos *-pro da família GPT-5 exigem a Responses API.
        if (/gpt-5.*pro/i.test(payload.model)) {
            try {
                const r: any = await (this.openai as any).responses.create({
                    model: payload.model,
                    input: [{ role: 'user', content: [{ type: 'input_text', text: `${system}\n\n${user}` }] }],
                    reasoning: { effort: 'medium' },
                });
                let text: string = r.output_text || '';
                if (!text && Array.isArray(r.output)) {
                    for (const item of r.output) {
                        if (item.type === 'message' && Array.isArray(item.content)) {
                            const ti = item.content.find((c: any) => c.type === 'output_text');
                            if (ti?.text) {
                                text = ti.text;
                                break;
                            }
                        }
                    }
                }
                if (text) return { result: this.safeParseJson(text), usage: r.usage, modelUsed: payload.model };
            } catch (ePro: any) {
                console.warn(`crossAnalyze: Responses API falhou p/ ${payload.model} (${ePro?.message}). Fallback chat/gpt-4o.`);
            }
        }

        const attempt = async (model: string, useJsonFormat: boolean, useSystem: boolean) => {
            const messages: any[] = useSystem
                ? [{ role: 'system', content: system }, { role: 'user', content: user }]
                : [{ role: 'user', content: `${system}\n\n${user}` }];
            const req: any = { model, messages };
            if (useJsonFormat) req.response_format = { type: 'json_object' };
            const c = await this.openai.chat.completions.create(req);
            return { text: c.choices[0].message.content || '', usage: c.usage, model };
        };

        let res: { text: string; usage: any; model: string };
        try {
            res = await attempt(payload.model, true, true);
        } catch (e1: any) {
            console.warn(`crossAnalyze: modelo ${payload.model} recusou json/system (${e1?.message}). Tentando modo simples...`);
            try {
                res = await attempt(payload.model, false, false);
            } catch (e2: any) {
                console.warn(`crossAnalyze: modelo ${payload.model} falhou (${e2?.message}). Fallback gpt-4o.`);
                res = await attempt('gpt-4o', true, true);
            }
        }
        return { result: this.safeParseJson(res.text), usage: res.usage, modelUsed: res.model };
    }

    /** Gera um brief do próximo vídeo a partir dos padrões dos vídeos que mais converteram. */
    async generateVideoBrief(payload: {
        crossInsights?: any;
        perVideo?: any[];
        theme?: string;
        model: string;
    }): Promise<{ result: any; usage: any; modelUsed: string }> {
        const ci = payload.crossInsights ? JSON.stringify(payload.crossInsights) : '(sem insights cruzados)';
        const winners = (payload.perVideo || [])
            .slice()
            .sort((a: any, b: any) => (b?.revenue || 0) - (a?.revenue || 0) || (b?.won || 0) - (a?.won || 0))
            .slice(0, 5)
            .map(
                (v: any) =>
                    `- ${v.videoId}: vendas=${v.won ?? 0}, receita=${v.revenue ?? 0}, ticket=${v.ticketMedio ?? 0}, publico=${v.audienceProfile?.tier || '?'}; drivers=${JSON.stringify(v.conversionDrivers || {})}`,
            )
            .join('\n');

        const system =
            'Você é um roteirista e estrategista de YouTube focado em conversão para vendas. Responda APENAS JSON, sem texto fora do JSON.';
        const user =
            `Com base nos padrões dos vídeos que MAIS converteram (vendas/receita), monte um BRIEF para o PRÓXIMO vídeo.\n\n` +
            `PADRÕES/INSIGHTS CRUZADOS: ${ci}\n\n` +
            `VÍDEOS VENCEDORES (resumo):\n${winners || '(sem dados)'}\n\n` +
            (payload.theme ? `TEMA/PRODUTO DESEJADO PARA O PRÓXIMO VÍDEO: ${payload.theme}\n\n` : '') +
            `Gere um JSON com:\n` +
            `"titulos" (array de 3-5 títulos altamente clicáveis no estilo dos vencedores),\n` +
            `"thumbnail" ({ "conceito": string, "texto": string (texto curto da arte), "elementos": [string] }),\n` +
            `"hook" (os primeiros 15-20s falados),\n` +
            `"roteiro" (array de blocos { "secao": string, "objetivo": string, "pontos": [string] }),\n` +
            `"cta" (chamada para ação conectando o conteúdo à oferta),\n` +
            `"publico_alvo" (quem é, nível e dores),\n` +
            `"gatilhos" (array de gatilhos de conversão a usar).`;

        const attempt = async (model: string, useJson: boolean, useSystem: boolean) => {
            const messages: any[] = useSystem
                ? [{ role: 'system', content: system }, { role: 'user', content: user }]
                : [{ role: 'user', content: `${system}\n\n${user}` }];
            const req: any = { model, messages };
            if (useJson) req.response_format = { type: 'json_object' };
            const c = await this.openai.chat.completions.create(req);
            return { text: c.choices[0].message.content || '', usage: c.usage, model };
        };

        let res: { text: string; usage: any; model: string };
        try {
            res = await attempt(payload.model, true, true);
        } catch (e1: any) {
            try {
                res = await attempt(payload.model, false, false);
            } catch {
                res = await attempt('gpt-4o', true, true);
            }
        }
        return { result: this.safeParseJson(res.text), usage: res.usage, modelUsed: res.model };
    }
}
