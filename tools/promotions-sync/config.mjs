import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = dirname(fileURLToPath(import.meta.url));

// Lê o .env da pasta da ferramenta (sem dependência externa).
const envFile = join(TOOL_DIR, '.env');
if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
}

const required = (name) => {
    const v = process.env[name];
    if (!v) throw new Error(`Falta ${name} no arquivo ${envFile} (veja .env.example)`);
    return v;
};

export const CHANNEL_ID = required('CHANNEL_ID');
export const BACKEND_URL = (process.env.BACKEND_URL || 'https://yt-dashboard-backend.vercel.app').replace(/\/$/, '');
export const CRON_SECRET = required('CRON_SECRET');
export const HEADLESS = process.env.HEADLESS !== '0';

// Perfil do Chrome só desta ferramenta: o login no Studio fica guardado aqui, fora do seu Chrome normal.
export const DATA_DIR = process.env.DATA_DIR || join(process.env.LOCALAPPDATA || TOOL_DIR, 'yt-dashboard');
export const PROFILE_DIR = join(DATA_DIR, 'studio-profile');
export const LOG_FILE = join(DATA_DIR, 'promotions-sync.log');
mkdirSync(PROFILE_DIR, { recursive: true });

export const PROMOTIONS_URL = `https://studio.youtube.com/channel/${CHANNEL_ID}/content/promotions`;

export const browserOptions = (headless) => ({
    channel: 'chrome', // Chrome instalado na máquina, não o Chromium do Playwright
    headless,
    viewport: { width: 1400, height: 900 },
    locale: 'pt-BR',
    // sem a flag de automação o Google trata a janela como um Chrome comum
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
});
