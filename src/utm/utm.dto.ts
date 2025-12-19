export class GenerateSlugDto {
    title: string;
}

export class ShortenLinkDto {
    originalURL: string;
    slug: string; // The full slug including prefix
    title: string;
    video_url?: string;
    video_id?: string;
}

export class SaveLinkDto {
    title: string;
    publish_date?: string;
    base_url: string;
    slug: string;
    utm_content: string;
    final_url: string;
    short_url?: string;
    short_code?: string;
    is_draft: boolean;
    video_url?: string;
    video_id?: string;
}
