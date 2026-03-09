/**
 * Vercel Serverless Function — Proxy vers l'API Anthropic.
 * Protège la clé API côté serveur (pas d'exposition côté client).
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API Anthropic non configurée' });

  try {
    const { system, messages, max_tokens = 300 } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        system: system || '',
        messages: messages || [],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Proxy] Anthropic error:', response.status, errorText);
      return res.status(response.status).json({ error: `Erreur API: ${response.status}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (err) {
    console.error('[AI Proxy] Error:', err.message);
    return res.status(500).json({ error: 'Erreur interne du service IA' });
  }
}
