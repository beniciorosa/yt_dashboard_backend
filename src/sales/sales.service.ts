import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { OpenaiService } from '../openai/openai.service';

export interface SalesRankingItem {
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  totalRevenue: number;
  dealsCount: number;
  wonCount: number;
  wonToday: number;
  lostCount: number;
  conversionRate: number;
  products: string[];
}

export interface SalesSummary {
  totalRevenue: number;
  totalDeals: number;
  totalWon: number;
  conversionRate: number;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);
  private supabase: SupabaseClient;

  constructor(
    private configService: ConfigService,
    private openaiService: OpenaiService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')?.trim();
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY')?.trim();

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials missing');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
  }

  async getSalesRanking(period: string = 'month', customStart?: string, customEnd?: string): Promise<SalesRankingItem[]> {
    const isAllPeriod = period === 'all';
    const { start, end } = this.getPeriodDates(period, customStart, customEnd);

    const startTimeManual = Date.now();

    // 1. Fetch LINKS first to get relevant UTMs
    let links: any[] = [];
    try {
      this.logger.log('Fetching links from yt_links...');
      const { data, error: linksError } = await this.supabase
        .from('yt_links')
        .select('*');

      if (linksError) throw linksError;
      links = data || [];
      this.logger.log(`Found ${links.length} total links in yt_links`);
    } catch (e: any) {
      this.logger.error('Error fetching links from Supabase', { message: e.message, code: e.code });
      return [];
    }

    if (!links || links.length === 0) {
      this.logger.warn('No links found in yt_links table (or connection failed)');
      return [];
    }

    const utmToLinkMap = new Map<string, any>();
    const utmVariants = new Set<string>();

    links.forEach(link => {
      if (link.utm_content) {
        const raw = String(link.utm_content).trim();
        const lower = raw.toLowerCase();
        const upper = raw.toUpperCase();

        utmToLinkMap.set(lower, link);
        utmVariants.add(raw);
        utmVariants.add(lower);
        utmVariants.add(upper);
      }
    });

    this.logger.log(`Generated ${utmVariants.size} UTM variants from links`);
    if (utmVariants.size === 0) {
      this.logger.warn('No utm_content found in any of the fetched links');
      return [];
    }
    const utmsToQuery = Array.from(utmVariants);
    this.logger.log(`Querying hubspot_negocios for UTMs: ${utmsToQuery.slice(0, 5).join(', ')}${utmsToQuery.length > 5 ? '...' : ''}`);

    // 2. Fetch only REQUIRED DEALS using UTM filter in clusters to avoid URL length limits
    let deals: any[] = [];
    const utmChunkSize = 200;
    const fetchPromises: Promise<any[]>[] = [];

    const startISO = start?.toISOString();
    const endISO = end?.toISOString();

    for (let i = 0; i < utmsToQuery.length; i += utmChunkSize) {
      const chunk = utmsToQuery.slice(i, i + utmChunkSize);

      const fetchChunk = async () => {
        let chunkDeals: any[] = [];
        let hasMore = true;
        let page = 0;
        const pageSize = 1000;

        while (hasMore) {
          try {
            let query = this.supabase
              .from('hubspot_negocios')
              .select('valor, etapa, utm_content, item_linha, data_fechamento, data_criacao')
              .in('utm_content', chunk);

            // Optimization: Filter by date directly in the database
            if (!isAllPeriod && startISO) {
              // Filtrar leads que foram criados OU fechados a partir da data de início do período
              query = query.or(`data_criacao.gte.${startISO},data_fechamento.gte.${startISO}`);
            }

            const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            if (data && data.length > 0) {
              chunkDeals = chunkDeals.concat(data);
              if (data.length < pageSize) hasMore = false;
              else page++;
            } else {
              hasMore = false;
            }
          } catch (e: any) {
            this.logger.error('Error fetching filtered deals chunk', { message: e.message, page });
            hasMore = false;
          }
        }
        return chunkDeals;
      };

      fetchPromises.push(fetchChunk());
    }

    const results = await Promise.all(fetchPromises);
    deals = results.flat();

    this.logger.log(`Fetched ${deals.length} total deals in parallel using chunks`);
    const afterDealsTime = Date.now();

    // 3. Fetch VIDEOS
    let videos: any[] = [];
    try {
      const { data, error: videosError } = await this.supabase
        .from('yt_myvideos')
        .select('video_id, title, thumbnail_url');

      if (videosError) throw videosError;
      videos = data || [];
    } catch (e) {
      this.logger.error('Error fetching videos from Supabase', e);
      // Fallback or just empty
    }

    // Map: videoId -> video
    const videoMap = new Map<string, any>();
    videos?.forEach(video => {
      videoMap.set(video.video_id, video);
    });

    // 3. Aggregate
    const videoStats = new Map<string, {
      revenue: number,
      deals: number,
      won: number,
      wonToday: number,
      lost: number,
      products: Set<string>
    }>();

    deals.forEach(deal => {
      if (!deal.utm_content) return;

      const dealUtm = String(deal.utm_content).trim().toLowerCase();
      const link = utmToLinkMap.get(dealUtm);

      if (!link || !link.video_id) return;

      const videoId = link.video_id;

      if (!videoStats.has(videoId)) {
        videoStats.set(videoId, { revenue: 0, deals: 0, won: 0, wonToday: 0, lost: 0, products: new Set() });
      }

      const stats = videoStats.get(videoId)!;

      // Filter logic:
      // Lead: count if data_criacao is within range
      const creationDate = deal.data_criacao ? new Date(deal.data_criacao) : null;
      const closingDate = deal.data_fechamento ? new Date(deal.data_fechamento) : null;

      const inCreationRange = isAllPeriod || (creationDate && end && creationDate >= start! && creationDate <= end);
      const inClosingRange = isAllPeriod || (closingDate && end && closingDate >= start! && closingDate <= end);

      if (inCreationRange || inClosingRange) {
        stats.deals++;
      }

      const etapa = deal.etapa?.toLowerCase() || '';
      const isWon = etapa.includes('ganho') || etapa.includes('won') || etapa.includes('fechado');
      const isLost = etapa.includes('perdido') || etapa.includes('lost');

      if (isWon && inClosingRange) {
        stats.won++;
        stats.revenue += Number(deal.valor || 0);

        // Check if won today (always per day, regardless of period filter)
        if (closingDate) {
          const today = new Date();
          if (
            closingDate.getDate() === today.getDate() &&
            closingDate.getMonth() === today.getMonth() &&
            closingDate.getFullYear() === today.getFullYear()
          ) {
            stats.wonToday++;
          }
        }
      } else if (isLost && inClosingRange) {
        stats.lost++;
      }

      if (deal.item_linha) {
        stats.products.add(deal.item_linha);
      }
    });

    // 4. Format Output
    const ranking: SalesRankingItem[] = [];

    videoStats.forEach((stats, videoId) => {
      const video = videoMap.get(videoId);

      ranking.push({
        videoId: videoId,
        videoTitle: video?.title || 'Video Desconhecido',
        thumbnailUrl: video?.thumbnail_url || '',
        totalRevenue: stats.revenue,
        dealsCount: stats.deals,
        wonCount: stats.won,
        wonToday: stats.wonToday,
        lostCount: stats.lost,
        conversionRate: stats.deals > 0 ? (stats.won / stats.deals) * 100 : 0,
        products: Array.from(stats.products)
      });
    });

    this.logger.log(`Ranking processed in ${Date.now() - afterDealsTime}ms. Total time: ${Date.now() - startTimeManual}ms`);
    return ranking.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  async getSalesSummary(period: string = 'month', customStart?: string, customEnd?: string): Promise<SalesSummary> {
    const ranking = await this.getSalesRanking(period, customStart, customEnd);

    const totalRevenue = ranking.reduce((acc, item) => acc + item.totalRevenue, 0);
    const totalDeals = ranking.reduce((acc, item) => acc + item.dealsCount, 0);
    const totalWon = ranking.reduce((acc, item) => acc + item.wonCount, 0);

    return {
      totalRevenue,
      totalDeals,
      totalWon,
      conversionRate: totalDeals > 0 ? (totalWon / totalDeals) * 100 : 0
    };
  }

  async getDashboardData(period: string = 'month', customStart?: string, customEnd?: string) {
    const ranking = await this.getSalesRanking(period, customStart, customEnd);

    const totalRevenue = ranking.reduce((acc, item) => acc + item.totalRevenue, 0);
    const totalDeals = ranking.reduce((acc, item) => acc + item.dealsCount, 0);
    const totalWon = ranking.reduce((acc, item) => acc + item.wonCount, 0);

    const { start, end } = this.getPeriodDates(period, customStart, customEnd);
    return {
      summary: {
        totalRevenue,
        totalDeals,
        totalWon,
        conversionRate: totalDeals > 0 ? (totalWon / totalDeals) * 100 : 0
      },
      ranking
    };
  }

  private getPeriodDates(period: string, customStart?: string, customEnd?: string): { start: Date | null, end: Date | null } {
    // Período personalizado: interpreta as datas (YYYY-MM-DD) como dia local de Brasília (UTC-3).
    if (period === 'custom') {
      if (!customStart || !customEnd) return { start: null, end: null };
      const start = new Date(`${customStart}T00:00:00.000-03:00`);
      const end = new Date(`${customEnd}T23:59:59.999-03:00`);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return { start: null, end: null };
      return { start, end };
    }

    const BR_OFFSET = -3; // Brasília is UTC-3

    // 1. Current UTC time
    const nowUtc = new Date();

    // 2. Current Brasília time (shifted raw time)
    const nowBr = new Date(nowUtc.getTime() + (BR_OFFSET * 3600 * 1000));

    // 3. Define boundaries relative to Brasília local day
    const start = new Date(nowBr);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(nowBr);
    end.setUTCHours(23, 59, 59, 999);

    switch (period) {
      case 'today':
        // start/end already set to today in BR
        break;

      case 'week':
        // Monday to Sunday in BR
        const day = start.getUTCDay(); // 0 is Sunday, 1 is Monday...
        const diff = start.getUTCDate() - day + (day === 0 ? -6 : 1);
        start.setUTCDate(diff);

        // End of week (Sunday 23:59:59 in BR)
        end.setTime(start.getTime());
        end.setUTCDate(start.getUTCDate() + 6);
        end.setUTCHours(23, 59, 59, 999);
        break;

      case 'month':
        start.setUTCDate(1);
        // Last day of month in BR
        const lastDayRaw = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
        end.setTime(lastDayRaw.getTime());
        break;

      case '30days':
        start.setUTCDate(start.getUTCDate() - 30);
        break;

      case '60days':
        start.setUTCDate(start.getUTCDate() - 60);
        break;

      case 'year':
        start.setUTCMonth(0, 1);
        const dec31 = new Date(Date.UTC(start.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
        end.setTime(dec31.getTime());
        break;

      case 'all':
      default:
        return { start: null, end: null };
    }

    // 4. Convert back to REAL UTC values by removing the BR offset
    const finalize = (d: Date) => new Date(d.getTime() - (BR_OFFSET * 3600 * 1000));

    return {
      start: finalize(start),
      end: finalize(end)
    };
  }

  async getDealsByVideo(videoId: string, period: string = 'month', customStart?: string, customEnd?: string) {
    const isAllPeriod = period === 'all';
    const { start, end } = this.getPeriodDates(period, customStart, customEnd);
    // 1. Fetch video details
    const { data: video } = await this.supabase
      .from('yt_myvideos')
      .select('title, thumbnail_url')
      .eq('video_id', videoId)
      .single();

    // 2. Find links for this video
    const { data: links } = await this.supabase
      .from('yt_links')
      .select('utm_content')
      .eq('video_id', videoId);

    if (!links || links.length === 0) {
      return { video, deals: [] };
    }

    const utms = links.map(l => l.utm_content).filter(Boolean);
    if (utms.length === 0) {
      return { video, deals: [] };
    }

    // 3. Fetch deals for these UTMs
    const { data: deals, error } = await this.supabase
      .from('hubspot_negocios')
      .select('*')
      .in('utm_content', utms)
      .order('data_criacao', { ascending: false });

    if (error) throw error;

    // Filter deals in memory to match ranking logic
    const filteredDeals = deals.filter(deal => {
      const creationDate = deal.data_criacao ? new Date(deal.data_criacao) : null;
      const closingDate = deal.data_fechamento ? new Date(deal.data_fechamento) : null;

      const inCreationRange = isAllPeriod || (creationDate && end && creationDate >= start! && creationDate <= end);
      const inClosingRange = isAllPeriod || (closingDate && end && closingDate >= start! && closingDate <= end);

      return inCreationRange || inClosingRange;
    });

    return { video, deals: filteredDeals };
  }

  // TOP 5 VÍDEOS — sempre todo o período (ignora a data selecionada), ranqueado por receita.
  async getTopVideos(limit = 5) {
    const ranking = await this.getSalesRanking('all');
    return ranking
      .filter(r => r.totalRevenue > 0)
      .slice(0, limit)
      .map(r => ({
        videoId: r.videoId,
        videoTitle: r.videoTitle,
        thumbnailUrl: r.thumbnailUrl,
        totalRevenue: r.totalRevenue,
        wonCount: r.wonCount,
        dealsCount: r.dealsCount,
      }));
  }

  // TOP 5 VENDEDORES — sempre todo o período, por receita, considerando os negócios
  // atribuídos a vídeos via UTM (consistente com o resto do módulo, baseado em links rastreados).
  async getTopVendedores(limit = 5) {
    // 1. UTMs atribuídas (links com video_id)
    const { data: links, error: linksError } = await this.supabase
      .from('yt_links')
      .select('utm_content, video_id');
    if (linksError) {
      this.logger.error('Error fetching links for vendedores', linksError);
      return [];
    }

    const utmVariants = new Set<string>();
    (links || []).forEach(link => {
      if (link.utm_content && link.video_id) {
        const raw = String(link.utm_content).trim();
        if (!raw) return;
        utmVariants.add(raw);
        utmVariants.add(raw.toLowerCase());
        utmVariants.add(raw.toUpperCase());
      }
    });

    const utms = Array.from(utmVariants);
    if (utms.length === 0) return [];

    // 2. Busca os negócios desses UTMs (todo o período) em paralelo, paginado
    const utmChunkSize = 200;
    const pageSize = 1000;
    const fetchPromises: Promise<any[]>[] = [];

    for (let i = 0; i < utms.length; i += utmChunkSize) {
      const chunk = utms.slice(i, i + utmChunkSize);
      fetchPromises.push((async () => {
        let acc: any[] = [];
        let page = 0;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await this.supabase
            .from('hubspot_negocios')
            .select('proprietario, valor, etapa')
            .in('utm_content', chunk)
            .range(page * pageSize, (page + 1) * pageSize - 1);
          if (error) { this.logger.error('Error fetching deals for vendedores', error); break; }
          if (data && data.length > 0) {
            acc = acc.concat(data);
            if (data.length < pageSize) hasMore = false; else page++;
          } else {
            hasMore = false;
          }
        }
        return acc;
      })());
    }

    const deals = (await Promise.all(fetchPromises)).flat();

    // 3. Agrega por proprietário (vendedor)
    const stats = new Map<string, { revenue: number; won: number; deals: number }>();
    deals.forEach(deal => {
      const name = (deal.proprietario && String(deal.proprietario).trim()) || 'Sem proprietário';
      if (!stats.has(name)) stats.set(name, { revenue: 0, won: 0, deals: 0 });
      const s = stats.get(name)!;
      s.deals++;
      const etapa = (deal.etapa || '').toLowerCase();
      const isWon = etapa.includes('ganho') || etapa.includes('won') || etapa.includes('fechado');
      if (isWon) {
        s.won++;
        s.revenue += Number(deal.valor || 0);
      }
    });

    return Array.from(stats.entries())
      .map(([name, s]) => ({ name, revenue: s.revenue, wonCount: s.won, dealsCount: s.deals }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  // ===================== ANÁLISES (comparação de períodos) =====================

  private isWonEtapa(etapa?: string): boolean {
    const e = (etapa || '').toLowerCase();
    return e.includes('ganho') || e.includes('won') || e.includes('fechado');
  }
  private isLostEtapa(etapa?: string): boolean {
    const e = (etapa || '').toLowerCase();
    return e.includes('perdido') || e.includes('lost');
  }
  private inRange(d: Date | null, start: Date | null, end: Date | null): boolean {
    if (!d || isNaN(d.getTime())) return false;
    if (!start || !end) return true; // período 'all'
    return d >= start && d <= end;
  }
  // Mesma semântica do ranking: lead conta se criado OU fechado no período; ganho/perdido só se FECHADO no período.
  private dealInPeriod(deal: any, start: Date | null, end: Date | null) {
    const created = deal.data_criacao ? new Date(deal.data_criacao) : null;
    const closed = deal.data_fechamento ? new Date(deal.data_fechamento) : null;
    const isLead = this.inRange(created, start, end) || this.inRange(closed, start, end);
    const won = this.isWonEtapa(deal.etapa) && this.inRange(closed, start, end);
    const lost = this.isLostEtapa(deal.etapa) && this.inRange(closed, start, end);
    return { isLead, won, lost, revenue: won ? Number(deal.valor || 0) : 0 };
  }

  private async loadAttributedLinks() {
    const { data: links, error } = await this.supabase.from('yt_links').select('utm_content, video_id');
    if (error) throw error;
    const utmToVideo = new Map<string, string>();
    const variants = new Set<string>();
    (links || []).forEach((l: any) => {
      if (l.utm_content && l.video_id) {
        const raw = String(l.utm_content).trim();
        if (!raw) return;
        utmToVideo.set(raw.toLowerCase(), l.video_id);
        variants.add(raw); variants.add(raw.toLowerCase()); variants.add(raw.toUpperCase());
      }
    });
    return { utmToVideo, variants: Array.from(variants) };
  }

  private async fetchAttributedDeals(variants: string[]) {
    if (variants.length === 0) return [];
    const utmChunkSize = 200, pageSize = 1000;
    const promises: Promise<any[]>[] = [];
    for (let i = 0; i < variants.length; i += utmChunkSize) {
      const chunk = variants.slice(i, i + utmChunkSize);
      promises.push((async () => {
        let acc: any[] = [], page = 0, more = true;
        while (more) {
          const { data, error } = await this.supabase
            .from('hubspot_negocios')
            .select('proprietario, valor, etapa, utm_content, data_criacao, data_fechamento')
            .in('utm_content', chunk)
            .range(page * pageSize, (page + 1) * pageSize - 1);
          if (error) { this.logger.error('fetchAttributedDeals error', error); break; }
          if (data && data.length > 0) { acc = acc.concat(data); if (data.length < pageSize) more = false; else page++; }
          else more = false;
        }
        return acc;
      })());
    }
    return (await Promise.all(promises)).flat();
  }

  // Negócios (qualquer origem) que tocam o período (criados OU fechados dentro dele)
  private async fetchAllDealsInRange(start: Date | null, end: Date | null) {
    const pageSize = 1000;
    let acc: any[] = [], page = 0, more = true;
    const s = start?.toISOString(), e = end?.toISOString();
    while (more) {
      let q = this.supabase.from('hubspot_negocios').select('proprietario, valor, etapa, data_criacao, data_fechamento');
      if (s && e) {
        q = q.or(`and(data_criacao.gte.${s},data_criacao.lte.${e}),and(data_fechamento.gte.${s},data_fechamento.lte.${e})`);
      }
      const { data, error } = await q.range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) { this.logger.error('fetchAllDealsInRange error', error); break; }
      if (data && data.length > 0) { acc = acc.concat(data); if (data.length < pageSize) more = false; else page++; }
      else more = false;
    }
    return acc;
  }

  private kpisFromAgg(agg: { revenue: number; leads: number; won: number }) {
    return {
      revenue: agg.revenue,
      leads: agg.leads,
      won: agg.won,
      conversionRate: agg.leads > 0 ? (agg.won / agg.leads) * 100 : 0,
      avgTicket: agg.won > 0 ? agg.revenue / agg.won : 0,
    };
  }
  private pctDelta(a: number, b: number): number {
    if (b === 0) return a > 0 ? 100 : 0;
    return ((a - b) / b) * 100;
  }

  async getAnalysis(params: {
    periodA?: string; startA?: string; endA?: string;
    periodB?: string; startB?: string; endB?: string;
    sellerScope?: 'youtube' | 'all';
  }) {
    const sellerScope = params.sellerScope === 'all' ? 'all' : 'youtube';
    const rangeA = this.getPeriodDates(params.periodA || 'month', params.startA, params.endA);
    const rangeB = this.getPeriodDates(params.periodB || 'custom', params.startB, params.endB);

    const { utmToVideo, variants } = await this.loadAttributedLinks();
    const attrDeals = await this.fetchAttributedDeals(variants);

    const { data: videos } = await this.supabase.from('yt_myvideos').select('video_id, title, thumbnail_url');
    const videoMap = new Map<string, any>();
    (videos || []).forEach((v: any) => videoMap.set(v.video_id, v));

    type Agg = { revenue: number; leads: number; won: number; lost: number };
    const mk = (): Agg => ({ revenue: 0, leads: 0, won: 0, lost: 0 });
    const add = (m: Map<string, Agg>, k: string, r: { isLead: boolean; won: boolean; lost: boolean; revenue: number }) => {
      if (!m.has(k)) m.set(k, mk());
      const a = m.get(k)!;
      if (r.isLead) a.leads++;
      if (r.won) { a.won++; a.revenue += r.revenue; }
      else if (r.lost) a.lost++;
    };

    const videoA = new Map<string, Agg>(), videoB = new Map<string, Agg>();
    const sellerYtA = new Map<string, Agg>(), sellerYtB = new Map<string, Agg>();
    const lastLead = new Map<string, Date>(), lastWon = new Map<string, Date>();
    const totA = mk(), totB = mk();
    const tlA = new Map<string, { leads: number; revenue: number }>();
    const tlB = new Map<string, { leads: number; revenue: number }>();

    const bumpTimeline = (m: Map<string, any>, deal: any, start: Date | null, end: Date | null) => {
      const created = deal.data_criacao ? new Date(deal.data_criacao) : null;
      const closed = deal.data_fechamento ? new Date(deal.data_fechamento) : null;
      if (this.inRange(created, start, end) && created) {
        const d = created.toISOString().split('T')[0];
        if (!m.has(d)) m.set(d, { leads: 0, revenue: 0 });
        m.get(d).leads++;
      }
      if (this.isWonEtapa(deal.etapa) && this.inRange(closed, start, end) && closed) {
        const d = closed.toISOString().split('T')[0];
        if (!m.has(d)) m.set(d, { leads: 0, revenue: 0 });
        m.get(d).revenue += Number(deal.valor || 0);
      }
    };

    attrDeals.forEach((deal: any) => {
      const utm = deal.utm_content ? String(deal.utm_content).trim().toLowerCase() : '';
      const videoId = utmToVideo.get(utm);
      if (!videoId) return;

      const created = deal.data_criacao ? new Date(deal.data_criacao) : null;
      const closed = deal.data_fechamento ? new Date(deal.data_fechamento) : null;
      if (created && (!lastLead.has(videoId) || created > lastLead.get(videoId)!)) lastLead.set(videoId, created);
      if (this.isWonEtapa(deal.etapa) && closed && (!lastWon.has(videoId) || closed > lastWon.get(videoId)!)) lastWon.set(videoId, closed);

      const rA = this.dealInPeriod(deal, rangeA.start, rangeA.end);
      const rB = this.dealInPeriod(deal, rangeB.start, rangeB.end);
      add(videoA, videoId, rA); add(videoB, videoId, rB);
      const seller = (deal.proprietario && String(deal.proprietario).trim()) || 'Sem proprietário';
      add(sellerYtA, seller, rA); add(sellerYtB, seller, rB);

      if (rA.isLead) totA.leads++; if (rA.won) { totA.won++; totA.revenue += rA.revenue; }
      if (rB.isLead) totB.leads++; if (rB.won) { totB.won++; totB.revenue += rB.revenue; }

      bumpTimeline(tlA, deal, rangeA.start, rangeA.end);
      bumpTimeline(tlB, deal, rangeB.start, rangeB.end);
    });

    // Sellers — escopo 'all' usa todos os negócios do HubSpot no período
    let sellerA = sellerYtA, sellerB = sellerYtB;
    if (sellerScope === 'all') {
      const [allA, allB] = await Promise.all([
        this.fetchAllDealsInRange(rangeA.start, rangeA.end),
        this.fetchAllDealsInRange(rangeB.start, rangeB.end),
      ]);
      sellerA = new Map(); sellerB = new Map();
      allA.forEach((d: any) => add(sellerA, (d.proprietario && String(d.proprietario).trim()) || 'Sem proprietário', this.dealInPeriod(d, rangeA.start, rangeA.end)));
      allB.forEach((d: any) => add(sellerB, (d.proprietario && String(d.proprietario).trim()) || 'Sem proprietário', this.dealInPeriod(d, rangeB.start, rangeB.end)));
    }

    // Monta video movers
    const classify = (a: Agg, b: Agg) => {
      if (b.leads === 0 && a.leads > 0) return 'novo';
      if (a.leads === 0 && b.leads > 0) return 'sumiu';
      const dl = this.pctDelta(a.leads, b.leads);
      if (dl >= 20) return 'aqueceu';
      if (dl <= -20) return 'esfriou';
      return 'estavel';
    };
    const videoIds = new Set<string>([...videoA.keys(), ...videoB.keys()]);
    const videoMovers = Array.from(videoIds).map(id => {
      const a = videoA.get(id) || mk(), b = videoB.get(id) || mk();
      const v = videoMap.get(id);
      return {
        videoId: id,
        videoTitle: v?.title || 'Vídeo Desconhecido',
        thumbnailUrl: v?.thumbnail_url || '',
        a: this.kpisFromAgg(a), b: this.kpisFromAgg(b),
        deltaRevenue: a.revenue - b.revenue,
        deltaLeads: a.leads - b.leads,
        deltaLeadsPct: this.pctDelta(a.leads, b.leads),
        status: classify(a, b),
        lastLeadDate: lastLead.get(id)?.toISOString() || null,
        lastWonDate: lastWon.get(id)?.toISOString() || null,
      };
    }).filter(m => m.a.leads > 0 || m.b.leads > 0)
      .sort((x, y) => Math.abs(y.deltaLeads) - Math.abs(x.deltaLeads));

    const sellerIds = new Set<string>([...sellerA.keys(), ...sellerB.keys()]);
    const sellerMovers = Array.from(sellerIds).map(name => {
      const a = sellerA.get(name) || mk(), b = sellerB.get(name) || mk();
      const ka = this.kpisFromAgg(a), kb = this.kpisFromAgg(b);
      return {
        name, a: ka, b: kb,
        deltaRevenue: a.revenue - b.revenue,
        deltaLeads: a.leads - b.leads,
        deltaConversion: ka.conversionRate - kb.conversionRate,
        status: classify(a, b),
      };
    }).filter(m => m.a.leads > 0 || m.b.leads > 0)
      .sort((x, y) => y.a.revenue - x.a.revenue);

    // Timelines ordenadas
    const tl = (m: Map<string, any>) => Array.from(m.entries()).map(([date, v]) => ({ date, leads: v.leads, revenue: v.revenue })).sort((a, b) => a.date.localeCompare(b.date));

    const kpis = {
      a: this.kpisFromAgg(totA), b: this.kpisFromAgg(totB),
      delta: {
        revenue: this.pctDelta(totA.revenue, totB.revenue),
        leads: this.pctDelta(totA.leads, totB.leads),
        won: this.pctDelta(totA.won, totB.won),
        conversionRate: (totA.leads > 0 ? totA.won / totA.leads * 100 : 0) - (totB.leads > 0 ? totB.won / totB.leads * 100 : 0),
        avgTicket: this.pctDelta(totA.won > 0 ? totA.revenue / totA.won : 0, totB.won > 0 ? totB.revenue / totB.won : 0),
      },
    };

    const insights = this.buildInsights(kpis, videoMovers, sellerMovers, rangeB);

    return {
      ranges: {
        a: { start: rangeA.start?.toISOString() || null, end: rangeA.end?.toISOString() || null },
        b: { start: rangeB.start?.toISOString() || null, end: rangeB.end?.toISOString() || null },
      },
      sellerScope,
      kpis,
      videoMovers,
      sellerMovers,
      timeline: { a: tl(tlA), b: tl(tlB) },
      insights,
    };
  }

  private buildInsights(kpis: any, videoMovers: any[], sellerMovers: any[], rangeB: { start: Date | null; end: Date | null }) {
    const out: { type: string; severity: 'positive' | 'negative' | 'neutral'; text: string }[] = [];
    const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
    const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0);

    // KPI geral
    if (kpis.b.leads > 0) {
      const d = kpis.delta.leads;
      out.push({ type: 'kpi', severity: d >= 0 ? 'positive' : 'negative', text: `Leads ${d >= 0 ? 'subiram' : 'caíram'} ${Math.abs(d).toFixed(0)}% (${kpis.b.leads} → ${kpis.a.leads}).` });
    }
    if (kpis.b.revenue > 0) {
      const d = kpis.delta.revenue;
      out.push({ type: 'kpi', severity: d >= 0 ? 'positive' : 'negative', text: `Receita ${d >= 0 ? 'subiu' : 'caiu'} ${Math.abs(d).toFixed(0)}% (${fmtBRL(kpis.b.revenue)} → ${fmtBRL(kpis.a.revenue)}).` });
    }

    // Vídeos que pararam de captar (tinham leads em B, zeraram em A)
    videoMovers.filter(v => v.status === 'sumiu' && v.b.leads >= 3)
      .slice(0, 4)
      .forEach(v => out.push({
        type: 'video_cooled',
        severity: 'negative',
        text: `"${v.videoTitle}" trazia ${v.b.leads} leads e zerou no período atual. Último lead em ${fmtDate(v.lastLeadDate)} — provavelmente parou de captar (pausado?). Considere republicar/impulsionar.`,
      }));
    // Quedas fortes
    videoMovers.filter(v => v.status === 'esfriou' && v.b.leads >= 5 && v.deltaLeadsPct <= -50)
      .slice(0, 3)
      .forEach(v => out.push({
        type: 'video_drop',
        severity: 'negative',
        text: `"${v.videoTitle}" caiu ${Math.abs(v.deltaLeadsPct).toFixed(0)}% em leads (${v.b.leads} → ${v.a.leads}).`,
      }));
    // Destaques de alta
    videoMovers.filter(v => (v.status === 'aqueceu' || v.status === 'novo') && v.a.leads >= 5)
      .slice(0, 2)
      .forEach(v => out.push({
        type: 'video_up',
        severity: 'positive',
        text: `"${v.videoTitle}" aqueceu: ${v.b.leads} → ${v.a.leads} leads. Boa hora para reforçar a divulgação.`,
      }));

    // Vendedores que perderam conversão
    sellerMovers.filter(s => s.b.leads >= 5 && s.deltaConversion <= -10)
      .slice(0, 3)
      .forEach(s => out.push({
        type: 'seller_drop',
        severity: 'negative',
        text: `${s.name}: conversão caiu de ${s.b.conversionRate.toFixed(0)}% para ${s.a.conversionRate.toFixed(0)}%.`,
      }));

    // Meta: manter a média de leads do período B
    if (kpis.b.leads > 0 && kpis.a.leads < kpis.b.leads) {
      out.push({
        type: 'goal',
        severity: 'neutral',
        text: `Para igualar os ${kpis.b.leads} leads do período comparado, faltam ${kpis.b.leads - kpis.a.leads} leads.`,
      });
    }

    return out.slice(0, 12);
  }

  // Resumo narrativo opcional gerado por IA a partir da comparação já calculada.
  async aiSummary(analysis: any): Promise<{ summary: string }> {
    const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0);
    const k = analysis?.kpis;
    const topDown = (analysis?.videoMovers || []).filter((v: any) => v.deltaLeads < 0).slice(0, 5)
      .map((v: any) => `- "${v.videoTitle}": ${v.b.leads}→${v.a.leads} leads (${v.status})`).join('\n');
    const topUp = (analysis?.videoMovers || []).filter((v: any) => v.deltaLeads > 0).slice(0, 5)
      .map((v: any) => `- "${v.videoTitle}": ${v.b.leads}→${v.a.leads} leads`).join('\n');
    const sellers = (analysis?.sellerMovers || []).slice(0, 6)
      .map((s: any) => `- ${s.name}: receita ${fmtBRL(s.b.revenue)}→${fmtBRL(s.a.revenue)}, conversão ${s.b.conversionRate.toFixed(0)}%→${s.a.conversionRate.toFixed(0)}%`).join('\n');

    const prompt = `Você é um analista de vendas. Com base na comparação entre dois períodos (A = atual, B = comparado), escreva um resumo objetivo em português (máx. 8 bullets) com diagnóstico e recomendações práticas. Foque no que mudou, no que parou de captar e no que fazer para manter/recuperar o ritmo de leads.

KPIs A (atual): leads ${k?.a?.leads}, vendas ${k?.a?.won}, receita ${fmtBRL(k?.a?.revenue)}, conversão ${k?.a?.conversionRate?.toFixed(1)}%
KPIs B (comparado): leads ${k?.b?.leads}, vendas ${k?.b?.won}, receita ${fmtBRL(k?.b?.revenue)}, conversão ${k?.b?.conversionRate?.toFixed(1)}%

Vídeos que caíram:
${topDown || '(nenhum)'}

Vídeos que subiram:
${topUp || '(nenhum)'}

Vendedores (A vs B):
${sellers || '(sem dados)'}
`;
    try {
      const summary = await this.openaiService.generateText(prompt, 'gpt-4o');
      return { summary: (summary || '').trim() };
    } catch (e: any) {
      this.logger.error('aiSummary failed', e?.message);
      throw new Error('Não foi possível gerar o resumo com IA no momento.');
    }
  }

  async getIconByUF(uf: string): Promise<string | null> {
    const normalized = uf.toUpperCase();
    const { data, error } = await this.supabase
      .from('icons')
      .select('icon_files(svg_content)')
      .eq('icon_name', normalized)
      .maybeSingle();

    if (error || !data) {
      this.logger.warn(`Icon not found for UF: ${normalized}`);
      return null;
    }

    return (data as any).icon_files?.svg_content || null;
  }
}
