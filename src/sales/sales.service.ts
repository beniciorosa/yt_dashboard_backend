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

  async getSalesRanking(): Promise<SalesRankingItem[]> {
    this.logger.log('Starting getSalesRanking...');
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
        .select('valor, etapa, utm_content, item_linha') // Select ONLY needed columns
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
      lost: number,
      products: Set<string>
    }>();

    deals.forEach(deal => {
      if (!deal.utm_content) return;

      const dealUtm = String(deal.utm_content).trim().toLowerCase();
      const link = utmToLinkMap.get(dealUtm);

      if (!link || !link.video_id) return; // Unlinked deal

      const videoId = link.video_id;

      if (!videoStats.has(videoId)) {
        videoStats.set(videoId, { revenue: 0, deals: 0, won: 0, lost: 0, products: new Set() });
      }

      const stats = videoStats.get(videoId)!;
      stats.deals++;

      // MAPPING: dealstage -> etapa, amount -> valor, products -> item_linha
      const etapa = deal.etapa?.toLowerCase() || '';
      const isWon = etapa.includes('ganho') || etapa.includes('won') || etapa.includes('fechado');
      const isLost = etapa.includes('perdido') || etapa.includes('lost');

      if (isWon) {
        stats.won++;
        stats.revenue += Number(deal.valor || 0);
      } else if (isLost) {
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
        lostCount: stats.lost,
        conversionRate: stats.deals > 0 ? (stats.won / stats.deals) * 100 : 0,
        products: Array.from(stats.products)
      });
    });

    this.logger.log(`Ranking processed in ${Date.now() - afterDealsTime}ms. Total time: ${Date.now() - startTimeManual}ms`);
    return ranking.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  async getSalesSummary(): Promise<SalesSummary> {
    const ranking = await this.getSalesRanking();

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

  async getDashboardData() {
    const ranking = await this.getSalesRanking();

    const totalRevenue = ranking.reduce((acc, item) => acc + item.totalRevenue, 0);
    const totalDeals = ranking.reduce((acc, item) => acc + item.dealsCount, 0);
    const totalWon = ranking.reduce((acc, item) => acc + item.wonCount, 0);

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

  async getDealsByVideo(videoId: string) {
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
      .order('data_fechamento', { ascending: false });

    if (error) throw error;
    return { video, deals };
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
