// Registro curado de modelos OpenAI usados pelo Cross-View + helpers de estimativa.
// Os preços são ESTIMATIVAS (USD por 1k tokens) e podem defasar — usados só para a
// estimativa de custo exibida ao usuário; o custo real é calculado pelo usage retornado.

export interface ModelInfo {
  id: string;
  label: string;
  inputPer1k: number;
  outputPer1k: number;
  vision: boolean;
  /** Se false, não é escolhido automaticamente como default (mas continua selecionável). */
  defaultEligible?: boolean;
  note?: string;
}

export const WHISPER_PER_MIN = 0.006;

// Ordenado por capacidade (mais forte primeiro). O default automático é o primeiro
// `defaultEligible !== false` disponível na chave.
export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'gpt-5.2-pro',
    label: 'GPT-5.2 Pro (raciocínio máximo)',
    inputPer1k: 0.015,
    outputPer1k: 0.12,
    vision: true,
    defaultEligible: false,
    note: 'O mais inteligente, porém bem mais lento/caro (Responses API; risco de timeout no serverless).',
  },
  { id: 'gpt-5.1', label: 'GPT-5.1', inputPer1k: 0.00125, outputPer1k: 0.01, vision: true },
  { id: 'gpt-5', label: 'GPT-5', inputPer1k: 0.00125, outputPer1k: 0.01, vision: true },
  { id: 'o3', label: 'o3 (raciocínio)', inputPer1k: 0.002, outputPer1k: 0.008, vision: true, note: 'Raciocínio forte.' },
  { id: 'gpt-4.1', label: 'GPT-4.1', inputPer1k: 0.002, outputPer1k: 0.008, vision: true },
  { id: 'gpt-4o', label: 'GPT-4o (visão, equilibrado)', inputPer1k: 0.0025, outputPer1k: 0.01, vision: true },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini (rápido e barato)', inputPer1k: 0.00015, outputPer1k: 0.0006, vision: true },
];

export function getPricing(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}

/** Default = primeiro do registry (mais capaz) que esteja disponível na chave e seja elegível. */
export function pickDefaultModel(availableIds: string[]): string {
  const avail = new Set(availableIds);
  const found = MODEL_REGISTRY.find((m) => m.defaultEligible !== false && avail.has(m.id));
  if (found) return found.id;
  // se nada do registry estiver disponível, cai no gpt-4o (piso seguro)
  return 'gpt-4o';
}

export function estimateWordsFromDurationSec(sec: number): number {
  // ~150 palavras faladas por minuto
  return Math.round((sec / 60) * 150);
}

export function estimateTokensFromText(text: string): number {
  // ~4 caracteres por token
  return Math.ceil((text || '').length / 4);
}

export function estimateTokensFromWords(words: number): number {
  return Math.ceil(words * 1.3);
}

/** Converte ISO8601 (PT#H#M#S) em segundos. */
export function parseIsoDurationToSeconds(iso?: string): number {
  if (!iso) return 0;
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}
