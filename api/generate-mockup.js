/**
 * Vercel Serverless Function — Generate product mockup via DALL-E 3.
 * Called 3 times per generation (face, side, perspective views).
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
    const { productType, color, designDescription, view } = req.body;

    if (!productType || !view) {
      return res.status(400).json({ error: 'productType et view requis' });
    }

    const viewDescriptions = {
      face: 'front view, facing the camera directly',
      side: 'side view at 45 degrees, showing the profile',
      perspective: 'three-quarter perspective view, dynamic angle',
    };

    const viewDesc = viewDescriptions[view] || viewDescriptions.face;

    const prompt = `Professional photorealistic 3D product mockup photography.
Product: ${productType} in ${color || 'white'} color.
View: ${viewDesc}.
Design/logo applied on the product: ${designDescription || 'clean professional logo placement'}.
Style: Studio lighting with soft shadows, clean light grey background,
commercial product photography quality, sharp details,
professional print shop presentation mockup.
The design should be clearly visible, well-integrated, with proper perspective distortion.
High quality, photorealistic, 4K resolution style.`;

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
      revised_prompt: data.data[0].revised_prompt,
    });
  } catch (err) {
    console.error('[Mockup] Error:', err.message);
    return res.status(500).json({ error: 'Erreur interne du service mockup' });
  }
}
