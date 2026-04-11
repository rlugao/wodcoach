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

// ─── Proxy para API Anthropic ───────────────────────────────────────────────
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
  res.sendStatus(200); // responde rápido pro Telegram não reenviar

  try {
    const message = req.body.message;
    if (!message || !message.text) return;

    const chatId = message.chat.id;
    const userText = message.text;

    // Chama o Claude com persona WodCoach
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
        system: `Você é o WodCoach, assistente pessoal de treino e performance do Rodrigo Lugão, 44 anos, atleta de CrossFit no 7NOVE CrossFit em São Paulo. 
Você analisa treinos, sono, recuperação e dá conselhos práticos e diretos. 
Seja objetivo, motivador e use linguagem de coach. Responda sempre em português.`,
        messages: [
          { role: 'user', content: userText }
        ]
      })
    });

    const claudeData = await claudeResponse.json();
    const replyText = claudeData.content?.[0]?.text || 'Erro ao processar sua mensagem.';

    // Envia resposta pro Telegram
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText
      })
    });

  } catch (error) {
    console.error('Erro no webhook Telegram:', error);
  }
});

app.listen(PORT, () => console.log(`WodCoach server rodando na porta ${PORT}`));
