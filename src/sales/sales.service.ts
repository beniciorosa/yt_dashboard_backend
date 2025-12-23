import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL')?.trim();
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY')?.trim();

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials missing');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
  }

  async getSalesRanking(period: string = 'month'): Promise<SalesRankingItem[]> {
    const isAllPeriod = period === 'all';
    const { start, end } = this.getPeriodDates(period);

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

  async getSalesSummary(period: string = 'month'): Promise<SalesSummary> {
    const ranking = await this.getSalesRanking(period);

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

  async getDashboardData(period: string = 'month') {
    const ranking = await this.getSalesRanking(period);

    const totalRevenue = ranking.reduce((acc, item) => acc + item.totalRevenue, 0);
    const totalDeals = ranking.reduce((acc, item) => acc + item.dealsCount, 0);
    const totalWon = ranking.reduce((acc, item) => acc + item.wonCount, 0);

    const { start, end } = this.getPeriodDates(period);
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

  private getPeriodDates(period: string): { start: Date | null, end: Date | null } {
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

  async getDealsByVideo(videoId: string, period: string = 'month') {
    const isAllPeriod = period === 'all';
    const { start, end } = this.getPeriodDates(period);
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
