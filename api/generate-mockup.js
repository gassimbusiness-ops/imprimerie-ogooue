/**
 * Vercel Serverless Function — Generate product mockup via gpt-image-1 (images/edits).
 * Uses uploaded logo as reference image for realistic integration.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Cle API OpenAI non configuree' });

  try {
    const { productType, color, view, logoUrl } = req.body;

    if (!productType || !view) {
      return res.status(400).json({ error: 'productType et view requis' });
    }

    const viewDescriptions = {
      face: 'front view, facing directly forward',
      side: 'side angle view at 45 degrees',
      perspective: 'three-quarter perspective view, dynamic angle',
    };

    const viewDesc = viewDescriptions[view] || viewDescriptions.face;

    const prompt = `Professional product photography mockup.
A ${productType} in ${color || 'white'} color, ${viewDesc}.
The logo/design from the reference image is applied on the ${productType} front area.
The logo maintains its exact colors, shapes and text from the reference image.
Realistic fabric texture, natural folds, studio lighting with soft shadows,
clean light grey background, commercial print shop presentation quality.
The design integrates naturally with the surface — proper perspective, photorealistic result.`;

    // If logoUrl provided, use images/edits with gpt-image-1
    if (logoUrl) {
      const logoResponse = await fetch(logoUrl);
      if (!logoResponse.ok) {
        return res.status(400).json({ error: 'Impossible de telecharger le logo' });
      }
      const logoBuffer = await logoResponse.arrayBuffer();
      const logoBlob = new Blob([logoBuffer], { type: 'image/png' });

      const formData = new FormData();
      formData.append('image', logoBlob, 'logo.png');
      formData.append('prompt', prompt);
      formData.append('model', 'gpt-image-1');
      formData.append('n', '1');
      formData.append('size', '1024x1024');
      formData.append('quality', 'high');

      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
      });

      const data = await response.json();

      if (data.error) {
        console.error('[Mockup] gpt-image-1 error:', data.error.message);
        return res.status(500).json({ error: data.error.message });
      }

      const imageBase64 = data.data[0].b64_json;
      return res.status(200).json({
        imageBase64: `data:image/png;base64,${imageBase64}`,
        view,
      });
    }

    // Fallback: no logo — use dall-e-3 generations
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error('[Mockup] DALL-E error:', data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    return res.status(200).json({
      url: data.data[0].url,
      view,
    });
  } catch (err) {
    console.error('[Mockup] Error:', err.message);
    return res.status(500).json({ error: 'Erreur interne du service mockup' });
  }
}
