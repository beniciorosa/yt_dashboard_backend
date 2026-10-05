// Coleta a tabela Conteúdo → Promoções do YouTube Studio e envia ao backend (POST /api/promotions/import).
// Mesma leitura do userscript antigo (scraper-promocoes.user.js), só que sem clique humano:
// roda sozinho pelo Agendador de Tarefas do Windows num Chrome logado com o perfil da ferramenta.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BACKEND_URL, CRON_SECRET, DATA_DIR, HEADLESS, LOG_FILE, PROFILE_DIR, PROMOTIONS_URL, browserOptions, describeDirs } from './config.mjs';

const dryRun = process.argv.includes('--dry-run');
const log = (msg) => {
    const line = `${new Date().toISOString()} ${msg}`;
    console.log(line);
    try { appendFileSync(LOG_FILE, line + '\n'); } catch { /* sem log em disco não é erro */ }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- funções que rodam DENTRO da página (mesmos seletores do userscript) ----
const pageFns = {
    scrape: () => {
        const txt = (r, s) => { const e = r.querySelector(s); return e ? e.innerText.trim().replace(/\s+/g, ' ') : ''; };
        const parseCurrency = (s) => { if (!s) return 0; s = s.replace(/[R$\s]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };
        const parseIntBR = (s) => parseInt((s || '').replace(/\D/g, ''), 10) || 0;
        return [...document.querySelectorAll('ytcp-promotion-row')].map((r) => {
            const img = r.querySelector('img');
            const custo = parseCurrency(txt(r, '.tablecell-cost'));
            const visualizacoes = parseIntBR(txt(r, '.tablecell-view-count'));
            const inscritos = parseIntBR(txt(r, '.tablecell-subscriptions'));
            return {
                titulo: txt(r, '.promotion-cell-info'),
                status: txt(r, '.tablecell-status'),
                meta: txt(r, '.tablecell-goal'),
                // o Studio renomeou a coluna ("Data de criação" → "Data de início"); aceita as duas
                data_criacao: txt(r, '.tablecell-start-date') || txt(r, '.tablecell-creation-date'),
                custo: String(custo),
                impressoes: String(parseIntBR(txt(r, '.tablecell-impressions'))),
                visualizacoes: String(visualizacoes),
                inscritos: String(inscritos),
                cpv: String(visualizacoes ? +(custo / visualizacoes).toFixed(4) : 0),
                cps: String(inscritos ? +(custo / inscritos).toFixed(4) : 0),
                thumbnail_url: img ? img.src : '',
            };
        });
    },
    footer: () => {
        const t = (document.querySelector('ytcp-table-footer') || {}).innerText || '';
        const m = t.match(/(\d+)\s*[–-]\s*(\d+)\s+de\s+(\d+)/);
        return m ? { from: +m[1], to: +m[2], total: +m[3] } : null;
    },
    firstVideoId: () => {
        const img = document.querySelector('ytcp-promotion-row img');
        return (img && (img.src.match(/\/vi(?:_webp)?\/([\w-]{11})/) || [])[1]) || null;
    },
    // Thumbnails carregam sob demanda; rola até elas para o video_id aparecer na URL.
    pendingThumbnails: () => {
        const imgs = [...document.querySelectorAll('ytcp-promotion-row img')];
        const pending = imgs.filter((i) => !/ytimg\.com\/vi/.test(i.src || ''));
        pending.forEach((i) => { try { i.scrollIntoView({ block: 'center' }); } catch { /* ignore */ } });
        return { total: imgs.length, pending: pending.length };
    },
    pagerDisabled: (sel) => {
        const b = document.querySelector(sel);
        return !b || b.getAttribute('aria-disabled') === 'true' || b.disabled;
    },
};

async function waitThumbnails(page, maxMs = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
        const { total, pending } = await page.evaluate(pageFns.pendingThumbnails);
        if (total && pending === 0) return true;
        await sleep(500);
    }
    return false;
}

// O Studio ignora cliques rápidos demais: espera a página trocar de verdade e tenta de novo.
async function clickPager(page, selector) {
    if (await page.evaluate(pageFns.pagerDisabled, selector)) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
        const beforeVideo = await page.evaluate(pageFns.firstVideoId);
        const beforeFrom = (await page.evaluate(pageFns.footer))?.from;
        // Clique via DOM (como o userscript fazia): diálogos/backdrops do Studio bloqueiam o clique de ponteiro.
        await page.$eval(selector, (b) => b.click());
        for (let i = 0; i < 20; i++) {
            await sleep(400);
            const nowVideo = await page.evaluate(pageFns.firstVideoId);
            const nowFrom = (await page.evaluate(pageFns.footer))?.from;
            if (nowVideo !== beforeVideo || nowFrom !== beforeFrom) return true;
        }
        await sleep(1500);
    }
    return false;
}

async function collectAll(page) {
    for (let i = 0; i < 40; i++) {
        const f = await page.evaluate(pageFns.footer);
        if (f && f.from === 1) break;
        if (!(await clickPager(page, '#navigate-before'))) break;
    }
    const all = [];
    const seen = new Set();
    for (let p = 0; p < 40; p++) {
        await sleep(1200);
        await waitThumbnails(page);
        for (const row of await page.evaluate(pageFns.scrape)) {
            const key = `${row.thumbnail_url || row.titulo}|${row.data_criacao}|${row.custo}`;
            if (seen.has(key)) continue;
            seen.add(key);
            all.push(row);
        }
        const f = await page.evaluate(pageFns.footer);
        log(`página ${p + 1}: ${all.length}${f ? `/${f.total}` : ''} promoções`);
        if (!f || f.to >= f.total) break;
        if (!(await clickPager(page, '#navigate-after'))) break;
    }
    return all;
}

async function send(rows) {
    const res = await fetch(`${BACKEND_URL}/api/promotions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
        body: JSON.stringify({ rows, dryRun, source: 'promotions-sync' }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`backend ${res.status}: ${body.slice(0, 300)}`);
    return body;
}

async function main() {
    log(`início${dryRun ? ' (dry-run: nada é gravado)' : ''} | headless=${HEADLESS}`);
    console.log(describeDirs());
    const context = await chromium.launchPersistentContext(PROFILE_DIR, browserOptions(HEADLESS));
    let page;
    try {
        page = context.pages()[0] || (await context.newPage());
        await page.goto(PROMOTIONS_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Sem login o Studio manda para accounts.google.com: avisa em vez de ficar esperando.
        const loginRedirect = page.waitForURL(/accounts\.google\.com/, { timeout: 60_000 }).then(
            () => { throw new Error('O perfil do Chrome não está logado no Studio. Rode: npm run login'); },
            () => undefined, // timeout da espera pelo redirect não é erro
        );
        // Se ainda assim o Studio mostrar "navegador incompatível", segue pelo link de pular.
        const skip = page.getByText(/pular para o youtube studio/i);
        await skip.waitFor({ timeout: 8_000 }).then(() => skip.click()).catch(() => undefined);

        await Promise.race([
            page.waitForSelector('ytcp-promotion-row, ytcp-table-footer', { timeout: 60_000 }).catch(() => {
                throw new Error(`A tabela de Promoções não apareceu em 60 s (página atual: ${page.url()}). Veja a captura em ${join(DATA_DIR, 'last-error.png')} ou rode com HEADLESS=0.`);
            }),
            loginRedirect,
        ]);

        // Fecha qualquer diálogo aberto (dicas, avisos) que ficaria por cima da tabela.
        await page.keyboard.press('Escape').catch(() => undefined);

        const rows = await collectAll(page);
        if (rows.length === 0) throw new Error('Nenhuma promoção encontrada na tela (layout mudou ou canal errado?)');
        const withVideo = rows.filter((r) => /\/vi(?:_webp)?\/[\w-]{11}/.test(r.thumbnail_url)).length;
        log(`coletadas ${rows.length} promoções (${withVideo} com vídeo identificado)`);

        const reply = await send(rows);
        log(`backend: ${reply.slice(0, 200)}`);
        log('fim: sucesso');
    } catch (e) {
        // captura da tela para diagnosticar o que o Studio mostrou (login, consentimento, layout novo)
        if (page) await page.screenshot({ path: join(DATA_DIR, 'last-error.png'), fullPage: false }).catch(() => undefined);
        throw e;
    } finally {
        await context.close();
    }
}

main().catch((e) => {
    log(`ERRO: ${e.message}`);
    process.exit(1);
});
