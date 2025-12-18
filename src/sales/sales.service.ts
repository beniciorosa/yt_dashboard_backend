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
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

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
    const { data: links, error: linksError } = await this.supabase
      .from('yt_links')
      .select('*');

    if (linksError) {
      this.logger.error('Error fetching links', linksError);
      throw linksError;
    }

    if (!links || links.length === 0) return [];

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

    if (utmVariants.size === 0) return [];
    const utmsToQuery = Array.from(utmVariants);

    // 2. Fetch only REQUIRED DEALS using UTM filter
    let deals: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('hubspot_negocios')
        .select('valor, etapa, utm_content, item_linha, data_fechamento, data_criacao')
        .in('utm_content', utmsToQuery)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        this.logger.error('Error fetching filtered deals', error);
        throw error;
      }

      if (data && data.length > 0) {
        deals = deals.concat(data);
        if (data.length < pageSize) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }

    this.logger.log(`Fetched ${deals.length} deals in ${Date.now() - startTimeManual}ms`);
    const afterDealsTime = Date.now();

    // 3. Fetch VIDEOS
    const { data: videos, error: videosError } = await this.supabase
      .from('yt_myvideos')
      .select('video_id, title, thumbnail_url'); // Select only needed columns

    if (videosError) {
      this.logger.error('Error fetching videos', videosError);
      throw videosError;
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
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    switch (period) {
      case 'today':
        return { start, end };

      case 'week':
        // Monday to Sunday
        const day = start.getDay(); // 0 is Sunday, 1 is Monday...
        const diff = start.getDate() - day + (day === 0 ? -6 : 1);
        start.setDate(diff);
        // End remains Sunday 23:59:59 of current week
        const sunday = new Date(start);
        sunday.setDate(start.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        return { start, end: sunday };

      case 'month':
        start.setDate(1);
        const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0);
        lastDay.setHours(23, 59, 59, 999);
        return { start, end: lastDay };

      case '30days':
        start.setDate(start.getDate() - 30);
        return { start, end };

      case '60days':
        start.setDate(start.getDate() - 60);
        return { start, end };

      case 'year':
        start.setMonth(0, 1);
        const dec31 = new Date(start.getFullYear(), 11, 31);
        dec31.setHours(23, 59, 59, 999);
        return { start, end: dec31 };

      case 'all':
      default:
        return { start: null, end: null };
    }
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
