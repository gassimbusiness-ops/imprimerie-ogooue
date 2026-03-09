/**
 * Vercel Serverless Function — Proxy vers OpenAI DALL-E 3.
 * Protège la clé API côté serveur (pas d'exposition côté client).
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API OpenAI non configurée' });

  try {
    const { prompt, size = '1024x1024', quality = 'standard' } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: `Professional marketing visual for a print shop in Gabon, Africa. ${prompt}. High quality, commercial style, vibrant colors suitable for African market.`,
        n: 1,
        size,
        quality,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('[DALL-E] Error:', data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    return res.status(200).json({
      url: data.data[0].url,
      revised_prompt: data.data[0].revised_prompt,
    });
  } catch (err) {
    console.error('[DALL-E] Error:', err.message);
    return res.status(500).json({ error: 'Erreur interne du service IA images' });
  }
}
