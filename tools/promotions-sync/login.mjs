// Passo único de configuração: abre o Chrome com o perfil da ferramenta para você entrar na
// conta do canal. Feche a janela quando o Studio estiver aberto; o login fica salvo no perfil.
import { chromium } from 'playwright';
import { PROFILE_DIR, PROMOTIONS_URL, browserOptions } from './config.mjs';

const context = await chromium.launchPersistentContext(PROFILE_DIR, browserOptions(false));
const page = context.pages()[0] || (await context.newPage());
await page.goto(PROMOTIONS_URL);

console.log('Entre na conta do canal nessa janela e aguarde a tela de Promoções abrir.');
console.log('Depois feche a janela do Chrome para terminar.');

await new Promise((resolve) => context.on('close', resolve));
console.log(`Login salvo em ${PROFILE_DIR}. Agora rode: npm run dry-run`);
