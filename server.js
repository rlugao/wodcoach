const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ─── Tokens Strava (em memória, atualizados via refresh) ────────────────────
let stravaTokens = {
  accessToken:  process.env.STRAVA_ACCESS_TOKEN,
  refreshToken: process.env.STRAVA_REFRESH_TOKEN,
  clientId:     process.env.STRAVA_CLIENT_ID,
  clientSecret: process.env.STRAVA_CLIENT_SECRET
};

// ─── Refresh token Strava ────────────────────────────────────────────────────
async function refreshStravaToken() {
  const r = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     stravaTokens.clientId,
      client_secret: stravaTokens.clientSecret,
      grant_type:    'refresh_token',
      refresh_token: stravaTokens.refreshToken
    })
  });
  const d = await r.json();
  if (d.access_token) {
    stravaTokens.accessToken  = d.access_token;
    stravaTokens.refreshToken = d.refresh_token;
    console.log('Strava token renovado!');
  }
}

// ─── Busca atividades Strava ─────────────────────────────────────────────────
async function fetchStravaActivities() {
  try {
    const after = Math.floor((Date.now() - 14 * 86400000) / 1000); // últimas 2 semanas
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=10`, {
      headers: { Authorization: `Bearer ${stravaTokens.accessToken}` }
    });

    if (r.status === 401) {
      await refreshStravaToken();
      return fetchStravaActivities();
    }

    const acts = await r.json();
    if (!acts.length) return 'Nenhuma atividade no Strava nos últimos 14 dias.';

    return acts.map(a => {
      const dist = (a.distance / 1000).toFixed(1);
      const dur  = Math.round(a.moving_time / 60);
      const hr   = a.average_heartrate ? `, FC média ${Math.round(a.average_heartrate)}bpm` : '';
      const cal  = a.calories ? `, ${a.calories}kcal` : '';
      return `• ${a.start_date_local?.slice(0,10)} — ${a.name} (${a.sport_type}): ${dist}km, ${dur}min${hr}${cal}`;
    }).join('\n');

  } catch (e) {
    console.error('Erro Strava:', e.message);
    return 'Não consegui buscar dados do Strava agora.';
  }
}

// ─── Proxy para API Anthropic ────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Proxy para Strava OAuth ─────────────────────────────────────────────────
app.post('/api/strava/token', async (req, res) => {
  try {
    const response = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Telegram Webhook ────────────────────────────────────────────────────────
app.post('/webhook/telegram', async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body.message;
    if (!message || !message.text) return;

    const chatId   = message.chat.id;
    const userText = message.text;

    // Busca atividades do Strava automaticamente
    const stravaData = await fetchStravaActivities();

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `Você é o WodCoach, coach pessoal de CrossFit do Rodrigo Lugão, 44 anos, atleta no 7NOVE CrossFit em São Paulo.
Você tem acesso aos dados reais de treino do Rodrigo do Strava:

ATIVIDADES RECENTES (últimas 2 semanas):
${stravaData}

Use esses dados para dar respostas personalizadas e contextualizadas.
Seja direto, motivador e fale em português do Brasil.
Máximo 4 parágrafos. Use *negrito* para insights-chave (Telegram usa *asterisco* para negrito).`,
        messages: [{ role: 'user', content: userText }]
      })
    });

    const claudeData = await claudeResponse.json();
    const replyText  = claudeData.content?.[0]?.text || 'Erro ao processar sua mensagem.';

    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: 'Markdown' })
    });

  } catch (error) {
    console.error('Erro no webhook Telegram:', error);
  }
});

app.listen(PORT, () => console.log(`WodCoach server rodando na porta ${PORT}`));
