import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
// Fica dentro da própria pasta da ferramenta (.data, ignorada pelo git) para login, dry-run e a
// tarefa agendada usarem sempre o mesmo perfil, independentemente do shell ou usuário que executa.
export const DATA_DIR = process.env.DATA_DIR || join(TOOL_DIR, '.data');
export const PROFILE_DIR = join(DATA_DIR, 'studio-profile');
export const LOG_FILE = join(DATA_DIR, 'promotions-sync.log');
mkdirSync(PROFILE_DIR, { recursive: true });

export const describeDirs = () => `perfil: ${PROFILE_DIR}
log: ${LOG_FILE}`;

export const PROMOTIONS_URL = `https://studio.youtube.com/channel/${CHANNEL_ID}/content/promotions`;

// Versão do Chrome instalado, para o user agent do modo sem janela ser igual ao de uma janela normal.
// O Chrome headless se anuncia como "HeadlessChrome" e o Studio responde com a tela de
// "navegador incompatível" em vez da tabela.
const chromeVersion = () => {
    try {
        return execFileSync('powershell', ['-NoProfile', '-Command',
            "(Get-Item (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe')).VersionInfo.ProductVersion"],
            { encoding: 'utf8', timeout: 15000 }).trim() || '141.0.0.0';
    } catch {
        return '141.0.0.0';
    }
};
export const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion()} Safari/537.36`;

export const browserOptions = (headless) => ({
    ...(headless ? { userAgent: USER_AGENT } : {}),
    channel: 'chrome', // Chrome instalado na máquina, não o Chromium do Playwright
    headless,
    viewport: { width: 1400, height: 900 },
    locale: 'pt-BR',
    // sem a flag de automação o Google trata a janela como um Chrome comum
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
});
