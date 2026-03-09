/**
 * Service IA — Interface client vers le proxy serverless Anthropic.
 * Toutes les fonctionnalités IA de l'app passent par ce service.
 */

const AI_ENDPOINT = '/api/ai';

/**
 * Appelle l'API IA via le proxy serverless.
 * @param {string} system - Prompt système
 * @param {string} userMessage - Message utilisateur
 * @param {number} maxTokens - Tokens max (défaut: 300)
 * @returns {Promise<string>} Réponse texte de l'IA
 */
export async function askAI(system, userMessage, maxTokens = 300) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system,
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${res.status}`);
    }

    const data = await res.json();
    return data.text || '';
  } catch (err) {
    console.error('[AI] Error:', err.message);
    throw err;
  }
}

/**
 * Chat multi-tour (pour le chatbot)
 * @param {string} system - Prompt système
 * @param {Array} messages - Historique [{role:'user'|'assistant', content:string}]
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
export async function chatAI(system, messages, maxTokens = 300) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, messages, max_tokens: maxTokens }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${res.status}`);
    }

    const data = await res.json();
    return data.text || '';
  } catch (err) {
    console.error('[AI Chat] Error:', err.message);
    throw err;
  }
}

/* ─── Prompts spécialisés ─── */

export const AI_PROMPTS = {
  catalogue: {
    description: (nom, categorie, prix) => ({
      system: `Tu es un expert en rédaction de fiches produits pour une imprimerie au Gabon. Réponds UNIQUEMENT avec la description, rien d'autre.`,
      prompt: `Génère une description commerciale courte (2-3 phrases) pour ce produit d'imprimerie :\n- Nom : ${nom}\n- Catégorie : ${categorie}\n- Prix : ${prix} FCFA\nTon professionnel et accessible, adapté au marché gabonais.`,
    }),
    tags: (nom, categorie) => ({
      system: `Tu es un expert en e-commerce pour une imprimerie au Gabon.`,
      prompt: `Pour ce produit d'imprimerie (${nom} - ${categorie}), suggère 4-5 tags pertinents pour la recherche.\nRéponds UNIQUEMENT avec les tags séparés par des virgules, ex: "flyer, impression, A5, papier glacé"`,
    }),
  },
  stocks: {
    seuil: (nom, categorie, unite) => ({
      system: `Tu es un expert en gestion de stocks pour une imprimerie au Gabon.`,
      prompt: `Pour l'article "${nom}" (catégorie: ${categorie}, unité: ${unite}), suggère un seuil de stock minimum réaliste avec une courte justification (1-2 phrases).\nFormat de réponse : "Seuil recommandé : X ${unite} — [justification]"`,
    }),
    messageFournisseur: (nom, fournisseur, quantite, unite) => ({
      system: `Tu es l'assistant d'une imprimerie au Gabon. Génère des messages professionnels courts.`,
      prompt: `Génère un message court et professionnel pour commander ce consommable auprès du fournisseur.\nArticle : ${nom}\nFournisseur : ${fournisseur}\nQuantité à commander : ${quantite} ${unite}\nLe message doit être adapté à un envoi WhatsApp ou SMS.\nRéponds UNIQUEMENT avec le message, en français, sans introduction.`,
    }),
  },
  prospection: {
    system: `Tu es l'assistant commercial de l'Imprimerie Ogooué à Moanda, Gabon.\nTu génères des messages de prospection commerciale professionnels mais chaleureux, adaptés au contexte africain et au marché local gabonais (FCFA, habitudes locales).\nNos services : impression numérique, textile (t-shirts, polos), objets pub, flyers, cartes visite, badges, roll-up, banderoles, mugs, autocollants, carnets.`,
    messageProspect: (nom, secteur, besoins, canal) => ({
      prompt: `Génère un message ${canal || 'WhatsApp'} pour ce prospect :\n- Nom/Entreprise : ${nom}\n- Secteur : ${secteur}\n- Besoins identifiés : ${besoins}\nLe message doit donner envie de répondre. Maximum 3 phrases.`,
    }),
    messageCampagne: (titre, cible, type) => ({
      prompt: `Génère un message promotionnel ${type || 'promotion'} pour nos clients :\n- Titre de la promotion : ${titre}\n- Cible : ${cible}\n- Message court, accrocheur, avec appel à l'action. Maximum 4 phrases.`,
    }),
  },
  chatbot: {
    system: (catalogueResume, commandesClient) => `Tu es l'assistant virtuel de l'Imprimerie Ogooué à Moanda, Gabon.

IDENTITÉ DE L'IMPRIMERIE :
- Adresse : Carrefour Fina en face de Finam, Moanda - Gabon
- Téléphone : 060 44 46 34 / 074 42 41 42
- Email : imprimerieogooue@gmail.com
- RCCM : RG/FCV 2023A0407

NOS SERVICES :
- Impression numérique (flyers, affiches, banderoles, roll-up, bâches)
- Impression sur textile (t-shirts, polos, casquettes, chemises, broderie)
- Objets publicitaires (mugs, stylos, badges, autocollants)
- Papeterie (carnets, cartes de visite, letterheads, calendriers)
- Sérigraphie et tampons

${catalogueResume ? `CATALOGUE ACTUEL :\n${catalogueResume}` : ''}
${commandesClient ? `COMMANDES DU CLIENT :\n${commandesClient}` : ''}

RÈGLES :
- Réponds TOUJOURS en français
- Sois chaleureux, professionnel, concis
- Si on te demande des prix exacts → donne les prix du catalogue ou dis "contactez-nous pour un devis"
- Si on te pose une question hors de ta compétence → oriente vers le téléphone ou email
- Ne donne JAMAIS de fausses informations
- Max 150 mots par réponse`,
  },
};
