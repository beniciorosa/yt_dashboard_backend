# Coleta diária das Promoções

Os dados de Promoções do YouTube Studio não existem em nenhuma API (YouTube ou Google Ads: as
campanhas criadas no Studio ficam ocultas). A única fonte é a tela Conteúdo → Promoções, por isso
esta ferramenta abre o Chrome instalado na máquina, já logado num perfil próprio, lê a tabela e
envia para o backend (`POST /api/promotions/import`), que grava um lote em `yt_promotions`.

## Configurar (uma vez)

```powershell
cd tools\promotions-sync
npm install
copy .env.example .env        # preencha CRON_SECRET
npm run login                 # entre na conta do canal e feche a janela
npm run dry-run               # coleta e valida sem gravar
npm run install-task          # agenda todo dia às 07:30
```

## Operação

- Log: `tools\promotions-sync\.data\promotions-sync.log`.
- O selo "Promoções" no cabeçalho do app mostra a última coleta; se falhar, o erro aparece no selo.
- Se o Google pedir login de novo (sessão expirada), rode `npm run login` outra vez.
- O perfil do Chrome fica em `tools\promotions-sync\.data\studio-profile`, separado do seu Chrome.
- Para ver a coleta acontecendo: `HEADLESS=0` no `.env`.
