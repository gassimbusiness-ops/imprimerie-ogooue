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
    const { prompt, size = '1024x1024', style = 'marketing' } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt requis' });

    // Le prefixe depend du style demande :
    // - 'product' : photo produit propre sur fond neutre (pour fiche catalogue)
    // - 'marketing' (defaut) : visuel marketing pour print shop
    const fullPrompt = style === 'product'
      ? `Professional product photography of ${prompt}. Clean studio lighting, neutral white or light background, centered, e-commerce catalogue style, sharp focus, high quality, no text, no watermark.`
      : `Professional marketing visual for a print shop in Gabon, Africa. ${prompt}. High quality, commercial style, vibrant colors suitable for African market.`;

    // Utilise gpt-image-1 (le modele dont dispose la cle OpenAI du projet).
    // gpt-image-1 retourne du base64 (b64_json), pas une URL.
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: fullPrompt,
        n: 1,
        size,
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('[GenImage] Error:', data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    const b64 = data.data?.[0]?.b64_json;
    const url = data.data?.[0]?.url;
    if (!b64 && !url) {
      return res.status(500).json({ error: 'Aucune image retournee par le service IA' });
    }

    return res.status(200).json({
      // On renvoie l'image directement en data URL base64 (perenne, pas d'expiration)
      imageBase64: b64 ? `data:image/png;base64,${b64}` : null,
      url: url || null,
    });
  } catch (err) {
    console.error('[GenImage] Error:', err.message);
    return res.status(500).json({ error: 'Erreur interne du service IA images' });
  }
}
