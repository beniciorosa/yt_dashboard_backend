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
            console.log(`OpenAI API Key loaded. Length: ${apiKey.length}, Starts with: ${apiKey.substring(0, 7)}..., Ends with: ...${apiKey.substring(apiKey.length - 4)}`);
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

      Gere uma saída JSON com exatamente 3 campos: "intro", "chapters", "hashtags".
      
      Regras para "intro":
      1. Escreva entre 2 a 3 parágrafos curtos e envolventes resumindo o conteúdo do vídeo, sempre divididos pelo espaçamento de uma linha entre eles.
      2. OBRIGATÓRIO: O primeiro parágrafo deve incluir as palavras-chave principais contidas no título do vídeo de forma natural nas primeiras 150 caracteres.
      3. Use tom persuasivo e em primeira pessoa ("Você vai entender", "Eu explico", "Vou te mostrar"), e o texto próximo da linguagem utilizada no vídeo, com menos formalidade.
      4. Não use saudações como "Olá pessoal". Vá direto ao ponto.
      
      Regras CRÍTICAS para "chapters" (EVITE ALUCINAÇÕES DE TEMPO E FORMATO):
      1. O SRT está no formato "HH:MM:SS,ms". VOCÊ DEVE CONVERTER PARA "MM:SS".
         Exemplo: Se o timestamp for "00:05:32,400", seu capítulo DEVE ser "05:32". 
         NÃO inclua a hora "00:" inicial.
      2. ANALISE O SRT REAL. O vídeo termina em ${lastTime}. NENHUM capítulo pode ter um horário superior a ${lastTime}.
      3. ESPAÇAMENTO OBRIGATÓRIO:
         - O primeiro capítulo deve ser "00:00 – Introdução".
         - O segundo capítulo NÃO PODE SER "00:01", "00:05" ou qualquer tempo imediatamente colado.
         - O segundo capítulo deve ter pelo menos 20 segundos de diferença do primeiro (Ex: 00:30 em diante).
         - Mantenha um intervalo saudável entre os tópicos. Não gere capítulos a cada 1 minuto se o assunto for o mesmo.
      4. QUANTIDADE:
         - Se o vídeo for curto (menos de 10 min), gere no máximo 4 ou 5 capítulos.
      5. O formato da string deve ser EXATAMENTE: "MM:SS – Título do Tópico".
      
      Regras para "hashtags":
      1. Gere exatamente 3 hashtags altamente relevantes.
      2. Formato: "#tag1 #tag2 #tag3".
      3. Separe por espaços. NÃO use vírgulas. Utilize Acentos se existir.

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
                hashtags: jsonResponse.hashtags || ""
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

    async generateSlug(title: string): Promise<string> {
        const prompt = `
            Role: SEO Expert for YouTube.
            Task: Create a concise URL slug from the video title.
            
            STRICT RULES:
            1. Length: Use EXACTLY 3 or 4 words.
            2. Content: Extract the core topic/subject. Remove stop words (pt-BR: a, o, de, da, do, com, sem, para, em, no, na).
            3. Format: lowercase-words-separated-by-hyphens
            4. No Dates: Do NOT include numbers related to dates.
            5. Output: Return ONLY the slug string. No markdown, no quotes, no explanations.

            Input Title: "${title}"
            Output Slug:
        `;

        try {
            const completion = await this.openai.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that generates slugs.' },
                    { role: 'user', content: prompt },
                ],
                model: 'gpt-4o', // Using gpt-4o as replacement for gemini-2.5-flash
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
}
