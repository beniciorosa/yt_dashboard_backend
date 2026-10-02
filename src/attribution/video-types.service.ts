import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../supabase/supabase.constants';
import { OpenaiService } from '../openai/openai.service';
import { Dimension, DIMENSIONS } from './closers.service';

const MODEL = 'gpt-4o-mini';
const BATCH = 40;
const PAGE = 1000;

const DIMENSION_GUIDE: Record<Dimension, string> = {
    tema: 'assunto principal do vídeo (ex.: importação, anúncios, precificação, notícias da plataforma)',
    formato: 'formato editorial (ex.: tutorial passo a passo, estudo de caso, notícia/atualização, opinião, bastidores, podcast/entrevista, short)',
    publico: 'nível de quem assiste (ex.: iniciante que ainda não vende, vendedor em crescimento, vendedor avançado)',
    produto: 'produto ou serviço da empresa que o vídeo naturalmente leva a comprar',
};

interface VideoRow {
    video_id: string;
    title: string;
    description: string | null;
    duration: string | null;
    published_at: string | null;
    thumbnail_url: string | null;
}

interface TypeRow {
    id: number;
    dimension: Dimension;
    name: string;
    description: string | null;
}

@Injectable()
export class VideoTypesService {
    private readonly logger = new Logger(VideoTypesService.name);

    constructor(
        @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
        private readonly openai: OpenaiService,
    ) { }

    /** Lê uma tabela inteira em páginas (o PostgREST limita cada resposta a 1000 linhas). */
    private async fetchAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
        const all: T[] = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await this.supabase.from(table).select(columns).order(orderBy).range(from, from + PAGE - 1);
            if (error) throw new Error(`${table}: ${error.message}`);
            all.push(...((data || []) as T[]));
            if (!data || data.length < PAGE) return all;
        }
    }

    private async types(): Promise<TypeRow[]> {
        const { data, error } = await this.supabase.from('video_types').select('id, dimension, name, description').order('name');
        if (error) throw new Error(error.message);
        return (data || []) as TypeRow[];
    }

    private assignments() {
        return this.fetchAll<{ video_id: string; dimension: Dimension; type_id: number; source: string }>(
            'video_type_assignments', 'video_id, dimension, type_id, source', 'video_id');
    }

    /** Taxonomia com a contagem de vídeos por tipo e a cobertura de classificação por dimensão. */
    async overview() {
        const [types, assignments, { count }] = await Promise.all([
            this.types(),
            this.assignments(),
            this.supabase.from('yt_myvideos').select('video_id', { count: 'exact', head: true }),
        ]);
        const perType = new Map<number, number>();
        const perDimension = new Map<Dimension, number>();
        for (const a of assignments) {
            perType.set(a.type_id, (perType.get(a.type_id) || 0) + 1);
            perDimension.set(a.dimension, (perDimension.get(a.dimension) || 0) + 1);
        }
        return {
            totalVideos: count || 0,
            dimensions: DIMENSIONS.map((dimension) => ({
                dimension,
                guide: DIMENSION_GUIDE[dimension],
                classified: perDimension.get(dimension) || 0,
                types: types.filter((t) => t.dimension === dimension).map((t) => ({ ...t, videos: perType.get(t.id) || 0 })),
            })),
        };
    }

    async videos() {
        const [videos, assignments] = await Promise.all([
            this.fetchAll<VideoRow>('yt_myvideos', 'video_id, title, thumbnail_url, published_at, duration', 'video_id'),
            this.assignments(),
        ]);
        const byVideo = new Map<string, Partial<Record<Dimension, { typeId: number; source: string }>>>();
        for (const a of assignments) {
            const entry = byVideo.get(a.video_id) || {};
            entry[a.dimension] = { typeId: a.type_id, source: a.source };
            byVideo.set(a.video_id, entry);
        }
        return videos
            .map((v) => ({ videoId: v.video_id, title: v.title, thumbnailUrl: v.thumbnail_url, publishedAt: v.published_at, types: byVideo.get(v.video_id) || {} }))
            .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    }

    async createType(dimension: Dimension, name: string, description?: string) {
        if (!DIMENSIONS.includes(dimension)) throw new BadRequestException('Dimensão inválida');
        if (!name?.trim()) throw new BadRequestException('Nome é obrigatório');
        const { data, error } = await this.supabase
            .from('video_types')
            .insert({ dimension, name: name.trim(), description: description?.trim() || null })
            .select()
            .single();
        if (error) throw new BadRequestException(error.code === '23505' ? 'Já existe um tipo com esse nome nessa dimensão' : error.message);
        return data;
    }

    async updateType(id: number, patch: { name?: string; description?: string }) {
        const update: Record<string, string | null> = {};
        if (patch.name !== undefined) {
            if (!patch.name.trim()) throw new BadRequestException('Nome é obrigatório');
            update.name = patch.name.trim();
        }
        if (patch.description !== undefined) update.description = patch.description.trim() || null;
        const { data, error } = await this.supabase.from('video_types').update(update).eq('id', id).select().single();
        if (error) throw new BadRequestException(error.message);
        return data;
    }

    async deleteType(id: number) {
        const { error } = await this.supabase.from('video_types').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return { success: true };
    }

    /** Correção manual: marca a origem como 'manual', que a IA nunca sobrescreve. typeId null remove. */
    async assign(videoId: string, dimension: Dimension, typeId: number | null) {
        if (!DIMENSIONS.includes(dimension)) throw new BadRequestException('Dimensão inválida');
        if (typeId === null) {
            const { error } = await this.supabase.from('video_type_assignments').delete().eq('video_id', videoId).eq('dimension', dimension);
            if (error) throw new Error(error.message);
            return { success: true };
        }
        const { data: type } = await this.supabase.from('video_types').select('dimension').eq('id', typeId).maybeSingle();
        if (!type || type.dimension !== dimension) throw new BadRequestException('Tipo não pertence a essa dimensão');
        const { error } = await this.supabase.from('video_type_assignments').upsert({
            video_id: videoId, dimension, type_id: typeId, source: 'manual', model: null, updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        return { success: true };
    }

    /** Produtos realmente vendidos, para a IA propor a dimensão "produto" com nomes reais. */
    private async soldProducts(): Promise<string[]> {
        const { data } = await this.supabase
            .from('hubspot_negocios')
            .select('item_linha')
            .ilike('etapa', '%ganho%')
            .not('item_linha', 'is', null)
            .order('data_fechamento', { ascending: false })
            .limit(1000);
        const counts = new Map<string, number>();
        for (const row of data || []) {
            for (const p of String(row.item_linha).split(';').map((s) => s.trim()).filter(Boolean)) {
                counts.set(p, (counts.get(p) || 0) + 1);
            }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name);
    }

    /** Cria a taxonomia inicial das dimensões que ainda não têm nenhum tipo. */
    private async proposeTaxonomy(missing: Dimension[], videos: VideoRow[]): Promise<number> {
        const sample = videos.slice(0, 250).map((v) => `- ${v.title}`).join('\n');
        const products = missing.includes('produto') ? await this.soldProducts() : [];

        const result = await this.openai.completeJson<Record<string, { name: string; description: string }[]>>(
            'Você organiza o acervo de um canal do YouTube em uma taxonomia enxuta para análise de vendas. Responda só JSON.',
            `Proponha de 4 a 8 tipos para cada dimensão abaixo, com base nos títulos. Os tipos de uma dimensão devem ser mutuamente exclusivos, curtos (até 4 palavras) e em português.

Dimensões:
${missing.map((d) => `- "${d}": ${DIMENSION_GUIDE[d]}`).join('\n')}
${products.length ? `\nProdutos vendidos pela empresa (use estes nomes na dimensão "produto", agrupando variações, e inclua "Nenhum específico"):\n${products.map((p) => `- ${p}`).join('\n')}` : ''}

Títulos (amostra):
${sample}

Formato: {"<dimensão>": [{"name": "...", "description": "uma frase dizendo quando usar"}]}`,
            MODEL,
        );

        const rows = missing.flatMap((dimension) =>
            (result[dimension] || [])
                .filter((t) => t?.name?.trim())
                .slice(0, 8)
                .map((t) => ({ dimension, name: t.name.trim(), description: t.description?.trim() || null })),
        );
        if (!rows.length) throw new Error('A IA não propôs nenhum tipo');
        const { error } = await this.supabase.from('video_types').upsert(rows, { onConflict: 'dimension,name', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        return rows.length;
    }

    /**
     * Classifica por IA os vídeos que ainda não têm tipo em alguma dimensão. Resumível: cada
     * chamada trabalha dentro do orçamento de tempo e devolve quantos faltam.
     */
    async classify(timeBudgetMs = 40000) {
        const startedAt = Date.now();
        const videos = (await this.fetchAll<VideoRow>('yt_myvideos', 'video_id, title, description, duration, published_at, thumbnail_url', 'video_id'))
            .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

        let types = await this.types();
        const missing = DIMENSIONS.filter((d) => !types.some((t) => t.dimension === d));
        let createdTypes = 0;
        if (missing.length) {
            createdTypes = await this.proposeTaxonomy(missing, videos);
            types = await this.types();
        }

        const assigned = new Set((await this.assignments()).map((a) => `${a.video_id}|${a.dimension}`));
        const pending = videos.filter((v) => DIMENSIONS.some((d) => !assigned.has(`${v.video_id}|${d}`)));

        const taxonomy = DIMENSIONS.map((d) =>
            `"${d}" (${DIMENSION_GUIDE[d]}):\n${types.filter((t) => t.dimension === d).map((t) => `  - ${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n')}`,
        ).join('\n\n');
        const typeId = new Map(types.map((t) => [`${t.dimension}|${t.name.toLowerCase()}`, t.id]));

        let classified = 0;
        for (let i = 0; i < pending.length && Date.now() - startedAt < timeBudgetMs; i += BATCH) {
            const batch = pending.slice(i, i + BATCH);
            const list = batch.map((v) => JSON.stringify({
                id: v.video_id,
                titulo: v.title,
                duracao: v.duration,
                descricao: (v.description || '').slice(0, 280),
            })).join('\n');

            const result = await this.openai.completeJson<{ videos: Record<string, string>[] }>(
                'Você classifica vídeos de um canal do YouTube numa taxonomia fixa. Use exatamente os nomes dados. Responda só JSON.',
                `Taxonomia:\n\n${taxonomy}\n\nPara cada vídeo escolha um tipo por dimensão. Se nenhum servir, omita a dimensão.\n\nVídeos:\n${list}\n\nFormato: {"videos": [{"id": "...", "tema": "...", "formato": "...", "publico": "...", "produto": "..."}]}`,
                MODEL,
            );

            const known = new Set(batch.map((v) => v.video_id));
            const rows = (result.videos || []).filter((r) => known.has(r.id)).flatMap((r) =>
                DIMENSIONS
                    .filter((d) => !assigned.has(`${r.id}|${d}`))
                    .map((d) => ({ d, id: typeId.get(`${d}|${String(r[d] || '').toLowerCase()}`) }))
                    .filter((x) => x.id !== undefined)
                    .map((x) => ({ video_id: r.id, dimension: x.d, type_id: x.id, source: 'ia', model: MODEL, updated_at: new Date().toISOString() })),
            );

            if (rows.length) {
                // ignoreDuplicates: uma correção manual feita durante a execução prevalece
                const { error } = await this.supabase
                    .from('video_type_assignments')
                    .upsert(rows, { onConflict: 'video_id,dimension', ignoreDuplicates: true });
                if (error) throw new Error(error.message);
            }
            classified += batch.length;
        }

        const summary = { createdTypes, classified, remaining: Math.max(0, pending.length - classified), durationMs: Date.now() - startedAt };
        this.logger.log(`[VideoTypes] ${JSON.stringify(summary)}`);
        return summary;
    }
}
