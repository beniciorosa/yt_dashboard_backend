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
    // 1. Fetch all required data (with pagination for deals)
    let deals: any[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    // Fetch DEALS with pagination
    while (hasMore) {
      const { data, error } = await this.supabase
        .from('hubspot_negocios')
        .select('*')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        this.logger.error('Error fetching deals', error);
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

    // Fetch LINKS (assuming < 1000 for now, but safer to paginate if huge)
    const { data: links, error: linksError } = await this.supabase
      .from('yt_links')
      .select('*');

    if (linksError) {
      this.logger.error('Error fetching links', linksError);
      throw linksError;
    }

    // Fetch VIDEOS
    const { data: videos, error: videosError } = await this.supabase
      .from('yt_myvideos')
      .select('*');

    if (videosError) {
      this.logger.error('Error fetching videos', videosError);
      throw videosError;
    }

    // 2. Map Links by utm_content (Normalized)
    const utmToLinkMap = new Map<string, any>();
    links?.forEach(link => {
      if (link.utm_content) {
        const key = String(link.utm_content).trim().toLowerCase();
        utmToLinkMap.set(key, link);
      }
    });

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

  async getDealsByVideo(videoId: string) {
    // Find links for this video
    const { data: links } = await this.supabase
      .from('yt_links')
      .select('utm_content')
      .eq('video_id', videoId);

    if (!links || links.length === 0) return [];

    const utms = links.map(l => l.utm_content).filter(Boolean);
    if (utms.length === 0) return [];

    // Fetch deals for these UTMs
    const { data: deals, error } = await this.supabase
      .from('hubspot_negocios')
      .select('*')
      .in('utm_content', utms)
      .order('data_fechamento', { ascending: false });

    if (error) throw error;
    return deals;
  }
}
