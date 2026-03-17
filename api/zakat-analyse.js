/**
 * Vercel Serverless Function — Analyse IA Zakat personnalisée
 * POST /api/zakat-analyse
 * Utilise Claude (Anthropic) pour fournir des conseils Zakat personnalisés.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nom, valeurPart, parts, investissementDepart, annee, zakatCalculee, zakatObligatoire } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configuree' });
  }

  const prompt = `Tu es un conseiller financier islamique expert en Zakat pour des entrepreneurs africains.

Voici la situation de l'associe pour l'annee ${annee} :
- Nom : ${nom || 'Associe'}
- Part dans l'imprimerie : ${parts || 0}%
- Valeur actuelle de la part : ${(valeurPart || 0).toLocaleString()} FCFA
- Investissement initial : ${(investissementDepart || 0).toLocaleString()} FCFA
- Zakat calculee : ${zakatObligatoire ? `${(zakatCalculee || 0).toLocaleString()} FCFA (obligatoire)` : 'Non obligatoire cette annee'}

Donne 3 conseils pratiques et personnalises :
1. Un conseil sur comment s'acquitter de cette Zakat (a qui donner, comment distribuer au Gabon)
2. Un conseil sur la planification financiere islamique pour l'annee suivante
3. Une note d'encouragement spirituelle liee a la Zakat et l'entreprise

Reponds en francais, de maniere chaleureuse et professionnelle, sans markdown (#, **, etc.).
Maximum 150 mots.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Zakat IA] Anthropic error:', response.status, errText);
      throw new Error('Erreur API IA');
    }

    const data = await response.json();
    const analyse = data.content?.[0]?.text || 'Analyse non disponible.';

    res.json({ analyse });
  } catch (err) {
    console.error('[Zakat IA] Error:', err);
    res.status(500).json({ error: err.message, analyse: 'Impossible de charger l\'analyse IA pour le moment. Le calcul de base reste valide.' });
  }
}
