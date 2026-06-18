import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { OpenaiService } from '../openai/openai.service';
import { SalesService } from '../sales/sales.service';
import { YoutubeService } from '../youtube/youtube.service';
import {
  MODEL_REGISTRY,
  WHISPER_PER_MIN,
  getPricing,
  pickDefaultModel,
  estimateWordsFromDurationSec,
  estimateTokensFromWords,
  parseIsoDurationToSeconds,
} from './models.config';

export interface ExtractStatus {
  videoId: string;
  ok: boolean;
  status: 'ready' | 'failed';
  transcriptSource?: string;
  hasTranscript?: boolean;
  cached?: boolean;
  error?: string;
}

const round = (n: number) => Math.round((n || 0) * 10000) / 10000;

@Injectable()
export class CrossViewService {
  private readonly logger = new Logger(CrossViewService.name);
  private supabase: SupabaseClient;

  constructor(
    private configService: ConfigService,
    private openaiService: OpenaiService,
    private salesService: SalesService,
    private youtubeService: YoutubeService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')?.trim();
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY')?.trim();
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing (cross-view)');
    this.supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  }

  // ---------------------------------------------------------------- MODELS
  async getModels() {
    const available = await this.openaiService.listModelIds();
    const availSet = new Set(available);
    const def = pickDefaultModel(available);
    const couldList = availSet.size > 0;

    const models = MODEL_REGISTRY.map((m) => ({
      ...m,
      available: couldList ? availSet.has(m.id) : true,
      isDefault: m.id === def,
    })).filter((m) => (couldList ? m.available : true));

    // garante que o default apareça mesmo se filtrado
    if (!models.some((m) => m.id === def)) {
      const base = getPricing(def);
      if (base) models.unshift({ ...base, available: true, isDefault: true });
    }
    return { models, default: def };
  }

  // ---------------------------------------------------------------- ESTIMATE
  async estimate(videoIds: string[], model: string) {
    if (!videoIds.length) {
      return { model, videosTotal: 0, videosUncached: 0, cost: null, timeSecondsEstimate: 0, notes: 'Selecione ao menos um vídeo.' };
    }

    const { data: vids } = await this.supabase.from('yt_myvideos').select('video_id, duration').in('video_id', videoIds);
    const { data: cached } = await this.supabase
      .from('cv_video_content')
      .select('video_id, transcript, transcript_source, duration_seconds')
      .in('video_id', videoIds);

    const cachedMap = new Map((cached || []).map((c: any) => [c.video_id, c]));
    const durMap = new Map((vids || []).map((v: any) => [v.video_id, parseIsoDurationToSeconds(v.duration)]));

    let whisperMinutesMax = 0;
    let extractionInputTokens = 0;
    let extractionOutputTokens = 0;
    let analysisInputTokens = 0;
    const uncached: string[] = [];

    for (const id of videoIds) {
      const c: any = cachedMap.get(id);
      const durSec = c?.duration_seconds ?? durMap.get(id) ?? 0;
      const hasTranscript = !!c?.transcript;
      if (!c) uncached.push(id);

      if (!hasTranscript) {
        // pode precisar de Whisper (limite superior — legenda baixável = grátis)
        whisperMinutesMax += durSec / 60;
        const trTokens = estimateTokensFromWords(estimateWordsFromDurationSec(durSec));
        // fingerprint (gpt-4o)
        extractionInputTokens += trTokens + 400;
        extractionOutputTokens += 400;
        // thumbnail vision (gpt-4o)
        extractionInputTokens += 800;
        extractionOutputTokens += 200;
      }

      // análise: por vídeo ~ fingerprint(300) + thumb(150) + transcript truncado(<=2000) + overhead(200)
      const trTokensTrunc = Math.min(2000, estimateTokensFromWords(estimateWordsFromDurationSec(durSec)));
      analysisInputTokens += 300 + 150 + trTokensTrunc + 200;
    }
    const analysisOutputTokens = 1500 + videoIds.length * 300;

    const pricing = getPricing(model) || getPricing('gpt-4o')!;
    const gpt4o = getPricing('gpt-4o')!;

    const whisperCostMax = whisperMinutesMax * WHISPER_PER_MIN;
    const extractionCost =
      (extractionInputTokens / 1000) * gpt4o.inputPer1k + (extractionOutputTokens / 1000) * gpt4o.outputPer1k;
    const analysisCost =
      (analysisInputTokens / 1000) * pricing.inputPer1k + (analysisOutputTokens / 1000) * pricing.outputPer1k;
    const totalCostMax = whisperCostMax + extractionCost + analysisCost;

    const whisperTimeSec = whisperMinutesMax * 60 * 0.4;
    const extractionTimeSec = uncached.length * 5;
    const analysisTimeSec = 8 + videoIds.length * 2;

    return {
      model,
      videosTotal: videoIds.length,
      videosUncached: uncached.length,
      cost: {
        currency: 'USD',
        whisperMax: round(whisperCostMax),
        extraction: round(extractionCost),
        analysis: round(analysisCost),
        totalMax: round(totalCostMax),
      },
      timeSecondsEstimate: Math.round(whisperTimeSec + extractionTimeSec + analysisTimeSec),
      notes:
        'Estimativa. O Whisper só é usado quando o vídeo não tem legenda baixável (legenda = grátis); por isso o custo de Whisper é um teto. Custo de extração não se repete (fica em cache).',
    };
  }

  // ---------------------------------------------------------------- STATUS
  async status(videoIds: string[]) {
    if (!videoIds.length) return { items: [] };
    const { data } = await this.supabase
      .from('cv_video_content')
      .select('video_id, transcript, transcript_source')
      .in('video_id', videoIds);
    const map = new Map((data || []).map((c: any) => [c.video_id, c]));
    const items = videoIds.map((id) => {
      const c: any = map.get(id);
      return {
        videoId: id,
        cached: !!c,
        hasTranscript: !!c?.transcript,
        transcriptSource: c?.transcript_source || null,
      };
    });
    return { items };
  }

  // ---------------------------------------------------------------- EXTRACT
  async extract(videoIds: string[], force = false): Promise<{ items: ExtractStatus[] }> {
    const items: ExtractStatus[] = [];
    for (const id of videoIds) {
      try {
        items.push(await this.extractOne(id, force));
      } catch (e: any) {
        this.logger.error(`[Extract] erro ${id}: ${e?.message || e}`);
        items.push({ videoId: id, ok: false, status: 'failed', error: e?.message || String(e) });
      }
    }
    return { items };
  }

  async extractOne(videoId: string, force = false): Promise<ExtractStatus> {
    const { data: existing } = await this.supabase
      .from('cv_video_content')
      .select('*')
      .eq('video_id', videoId)
      .maybeSingle();

    const { data: vid } = await this.supabase
      .from('yt_myvideos')
      .select('video_id, channel_id, title, description, thumbnail_url, duration')
      .eq('video_id', videoId)
      .maybeSingle();
    if (!vid) return { videoId, ok: false, status: 'failed', error: 'Vídeo não encontrado em yt_myvideos' };

    const durationSeconds = parseIsoDurationToSeconds((vid as any).duration);

    // idempotente: já cacheado com transcrição -> pronto (a menos que force)
    if (existing && !force && (existing as any).transcript && (existing as any).transcript_source && (existing as any).transcript_source !== 'none') {
      return {
        videoId,
        ok: true,
        status: 'ready',
        transcriptSource: (existing as any).transcript_source,
        hasTranscript: true,
        cached: true,
      };
    }

    // 1. Transcrição: legendas -> Whisper
    let transcript: string = (existing as any)?.transcript || '';
    let source: string = (existing as any)?.transcript_source || 'none';
    let lang: string = (existing as any)?.transcript_lang || 'pt';

    if (force || !transcript) {
      try {
        const cap = await this.youtubeService.getCaptionTranscript((vid as any).channel_id, videoId);
        if (cap?.text) {
          transcript = cap.text;
          source = 'captions';
          lang = cap.lang || 'pt';
        }
      } catch (e: any) {
        this.logger.warn(`[Extract] captions erro ${videoId}: ${e?.message || e}`);
      }

      if (!transcript) {
        const audio = await this.downloadAudioBuffer(videoId);
        if (audio) {
          try {
            const srt = await this.openaiService.transcribeBuffer(audio.buffer, audio.filename);
            if (srt && srt.trim()) {
              transcript = srt;
              source = 'whisper';
              lang = 'pt';
            }
          } catch (e: any) {
            this.logger.warn(`[Extract] whisper erro ${videoId}: ${e?.message || e}`);
          }
        }
      }
      if (!transcript) source = 'none';
    }

    // 2. fingerprint + thumbnail (recomputa se conteúdo mudou)
    const contentHash = createHash('sha256')
      .update(`${(vid as any).title}||${(vid as any).description}||${transcript}`)
      .digest('hex');

    let fingerprint = (existing as any)?.fingerprint || null;
    let fingerprintModel = (existing as any)?.fingerprint_model || null;
    let thumbDescriptor = (existing as any)?.thumb_descriptor || null;
    let thumbModel = (existing as any)?.thumb_model || null;

    const needsRecompute = force || !existing || (existing as any).content_hash !== contentHash;
    if (needsRecompute || !fingerprint) {
      fingerprint = await this.openaiService.fingerprintVideo({
        title: (vid as any).title,
        description: (vid as any).description,
        transcript,
      });
      fingerprintModel = 'gpt-4o';
    }
    if (needsRecompute || !thumbDescriptor) {
      thumbDescriptor = await this.openaiService.describeThumbnail((vid as any).thumbnail_url);
      thumbModel = 'gpt-4o';
    }

    // 3. upsert
    const row = {
      video_id: videoId,
      channel_id: (vid as any).channel_id,
      title: (vid as any).title,
      description: (vid as any).description,
      thumbnail_url: (vid as any).thumbnail_url,
      duration_seconds: durationSeconds,
      transcript: transcript || null,
      transcript_source: source,
      transcript_lang: lang,
      fingerprint,
      fingerprint_model: fingerprintModel,
      thumb_descriptor: thumbDescriptor,
      thumb_model: thumbModel,
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.supabase.from('cv_video_content').upsert(row, { onConflict: 'video_id' });
    if (error) {
      this.logger.error(`[Extract] upsert erro ${videoId}: ${error.message}`);
      return { videoId, ok: false, status: 'failed', error: error.message };
    }

    return { videoId, ok: true, status: 'ready', transcriptSource: source, hasTranscript: !!transcript, cached: false };
  }

  // Escape hatch: transcrição colada manualmente
  async setManualTranscript(videoId: string, transcript: string) {
    if (!transcript || !transcript.trim()) throw new HttpException('Transcrição vazia', HttpStatus.BAD_REQUEST);
    const { data: vid } = await this.supabase
      .from('yt_myvideos')
      .select('video_id, channel_id, title, description, thumbnail_url, duration')
      .eq('video_id', videoId)
      .maybeSingle();
    if (!vid) throw new HttpException('Vídeo não encontrado', HttpStatus.BAD_REQUEST);

    const fingerprint = await this.openaiService.fingerprintVideo({
      title: (vid as any).title,
      description: (vid as any).description,
      transcript,
    });
    const { data: existing } = await this.supabase
      .from('cv_video_content')
      .select('thumb_descriptor')
      .eq('video_id', videoId)
      .maybeSingle();
    const thumbDescriptor = (existing as any)?.thumb_descriptor || (await this.openaiService.describeThumbnail((vid as any).thumbnail_url));
    const contentHash = createHash('sha256')
      .update(`${(vid as any).title}||${(vid as any).description}||${transcript}`)
      .digest('hex');

    const row = {
      video_id: videoId,
      channel_id: (vid as any).channel_id,
      title: (vid as any).title,
      description: (vid as any).description,
      thumbnail_url: (vid as any).thumbnail_url,
      duration_seconds: parseIsoDurationToSeconds((vid as any).duration),
      transcript,
      transcript_source: 'manual',
      transcript_lang: 'pt',
      fingerprint,
      fingerprint_model: 'gpt-4o',
      thumb_descriptor: thumbDescriptor,
      thumb_model: 'gpt-4o',
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.supabase.from('cv_video_content').upsert(row, { onConflict: 'video_id' });
    if (error) throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    return { videoId, ok: true, status: 'ready', transcriptSource: 'manual', hasTranscript: true };
  }

  // ---------------------------------------------------------------- ANALYZE
  async analyze(videoIds: string[], model: string) {
    if (!videoIds.length) throw new HttpException('Selecione ao menos um vídeo', HttpStatus.BAD_REQUEST);

    const sorted = [...videoIds].sort();
    const setHash = createHash('sha256').update(JSON.stringify([sorted, model])).digest('hex');

    const { data: cachedAnalysis } = await this.supabase
      .from('cv_analyses')
      .select('*')
      .eq('set_hash', setHash)
      .maybeSingle();
    if (cachedAnalysis) return { cached: true, ...(cachedAnalysis as any) };

    const { data: contents } = await this.supabase.from('cv_video_content').select('*').in('video_id', videoIds);
    if (!contents || contents.length === 0) {
      throw new HttpException(
        'Nenhum conteúdo extraído para os vídeos selecionados. Rode a extração primeiro.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const ranking = await this.salesService.getSalesRanking('all');
    const salesMap = new Map(ranking.map((r) => [r.videoId, r]));

    const contentMap = new Map((contents as any[]).map((c) => [c.video_id, c]));
    const videos = videoIds
      .filter((id) => contentMap.has(id))
      .map((id) => {
        const c: any = contentMap.get(id);
        const s: any = salesMap.get(id);
        const won = s?.wonCount || 0;
        const revenue = s?.totalRevenue || 0;
        const salesFacts = {
          leads: s?.dealsCount || 0,
          won,
          revenue,
          ticketMedio: won > 0 ? revenue / won : 0,
          conversionRate: s?.conversionRate || 0,
          productMix: this.computeProductMix(s?.products || []),
        };
        return {
          videoId: id,
          title: c?.title,
          description: c?.description,
          transcript: c?.transcript,
          fingerprint: c?.fingerprint,
          thumbDescriptor: c?.thumb_descriptor,
          salesFacts,
        };
      });

    const { result, usage, modelUsed } = await this.openaiService.crossAnalyze({ videos, model });

    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? null;
    const pricing = getPricing(modelUsed) || getPricing('gpt-4o')!;
    const costUsd =
      inputTokens != null && outputTokens != null
        ? round((inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k)
        : null;

    const salesSnapshot = videos.map((v) => ({ videoId: v.videoId, ...v.salesFacts }));

    const row = {
      set_hash: setHash,
      video_ids: videoIds,
      period: 'all',
      model: modelUsed,
      result,
      sales_snapshot: salesSnapshot,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    };
    const { data: inserted, error } = await this.supabase
      .from('cv_analyses')
      .upsert(row, { onConflict: 'set_hash' })
      .select()
      .maybeSingle();
    if (error) this.logger.error(`[Analyze] upsert erro: ${error.message}`);

    return { cached: false, ...((inserted as any) || row) };
  }

  // ---------------------------------------------------------------- helpers
  private computeProductMix(products: string[]): { name: string; count: number }[] {
    const freq = new Map<string, number>();
    (products || []).forEach((ps) => {
      if (!ps) return;
      String(ps)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((item) => freq.set(item, (freq.get(item) || 0) + 1));
    });
    return Array.from(freq.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Baixa o áudio do vídeo (audio-only) para o fallback Whisper. Best-effort: requer @distube/ytdl-core. */
  private async downloadAudioBuffer(videoId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    let ytdl: any = null;
    try {
      const mod = '@distube/ytdl-core';
      // require dinâmico (string não-literal) p/ não quebrar o build se o pacote não estiver instalado
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ytdl = require(mod);
      if (ytdl?.default) ytdl = ytdl.default;
    } catch {
      this.logger.warn('[Whisper] @distube/ytdl-core indisponível — fallback de áudio desativado.');
      return null;
    }

    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio', filter: 'audioonly' });
      if (!format?.url) return null;

      const stream = ytdl.downloadFromInfo(info, { format });
      const chunks: Buffer[] = [];
      let total = 0;
      const MAX = 24 * 1024 * 1024; // 24MB (limite Whisper ~25MB)

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (c: Buffer) => {
          chunks.push(c);
          total += c.length;
          if (total > MAX) {
            stream.destroy();
            resolve(); // transcreve o início (suficiente p/ fingerprint)
          }
        });
        stream.on('end', () => resolve());
        stream.on('error', (err: any) => reject(err));
      });

      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) return null;
      const ext = format.container || 'm4a';
      return { buffer, filename: `audio.${ext}` };
    } catch (e: any) {
      this.logger.warn(`[Whisper] download de áudio falhou p/ ${videoId}: ${e?.message || e}`);
      return null;
    }
  }
}
