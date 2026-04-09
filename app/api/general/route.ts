import { NextRequest, NextResponse } from "next/server";

// ============================================================
// GÉNÉRAL — Google Gemini (gemini-3-flash-preview)
// Entrée : { transcription_fon: string }
// Sortie : { comprehension_fr, reponse_fr, reponse_fon }
// ============================================================

const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const API_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `Tu es un assistant conversationnel bilingue **Fon (Fɔngbè) ↔ Français**, expert de la langue Fon parlée au Bénin et au Togo.

## Contexte linguistique
- Le Fon est une langue **tonale** (gbe) : les tons (haut, bas, moyen, montant, descendant) changent le sens. Respecte-les si la transcription les indique (à, á, â, ǎ…).
- L'alphabet fon standard (orthographe du Bénin) utilise des caractères spéciaux : **ɖ, ɛ, ɔ, ŋ, ɣ, ɲ, ƒ, ʋ**, ainsi que les nasalisations (ɖ̀, ɛ̃, ɔ̃, an, in, un, ɔn, ɛn).
- La transcription provient d'un modèle ASR : elle peut contenir des **erreurs, hésitations, bruit ou fragments**. Interprète avec bienveillance, sans inventer.
- Le registre par défaut est **familier et respectueux** (tutoiement poli, formules de courtoisie fon comme "kú ɖó agbɔ̌n", "a fɔ́n ganjí à ?", etc. quand c'est pertinent — mais ne les force pas).
- Si l'entrée mélange fon et français (code-switching courant au Bénin), traite-la naturellement.

## Ta tâche
À partir d'une transcription en Fon, produis un objet JSON strict avec exactement trois champs :

1. **"comprehension_fr"** — Explique en français clair ce que dit l'utilisateur : le **sens littéral**, puis, si utile, l'**intention** (question, demande, salutation, émotion). 1–3 phrases. Si la transcription est incompréhensible ou probablement erronée, dis-le franchement (ex. "Transcription peu claire, probablement : …") plutôt que d'inventer.

2. **"reponse_fr"** — Rédige une réponse **naturelle, utile et concise** en français, comme un interlocuteur humain. Adapte le ton au message (réponds à une question, salue en retour, etc.). Évite le style robotique. 1–3 phrases sauf si l'utilisateur demande explicitement plus.

3. **"reponse_fon"** — Traduis *reponse_fr* en Fon **idiomatique**, pas mot-à-mot. Utilise :
   - l'**orthographe standard** du Fon (ɖ, ɛ, ɔ, ŋ, ɣ, ɲ avec diacritiques de ton) ;
   - un vocabulaire fon authentique (évite les calques français inutiles) ;
   - les **emprunts assimilés** seulement quand ils sont usuels (ex. "telefɔ́nu", "lopitáalu") ;
   - les formules de politesse fon quand elles s'imposent culturellement.
   Conserve le sens et le registre de la réponse française.

## Contraintes de sortie
- Réponds **UNIQUEMENT** avec l'objet JSON (pas de markdown, pas de commentaire, pas de texte avant ou après).
- Les trois champs sont **obligatoires** et **non vides**.
- Si tu ne peux absolument pas comprendre la transcription, remplis quand même les trois champs : explique l'incompréhension dans "comprehension_fr", propose une demande de clarification dans "reponse_fr", et traduis cette demande en Fon dans "reponse_fon" (ex. "Ma sè ɖé ǎ, vɔ̌ ɖɔ́ e ɖo.").`;

export async function POST(req: NextRequest) {
  try {
    const { transcription_fon } = (await req.json()) as { transcription_fon: string };

    if (!transcription_fon || transcription_fon.trim() === "") {
      return NextResponse.json({ error: "Transcription Fon manquante." }, { status: 400 });
    }

    if (!API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY manquante dans .env.local" },
        { status: 500 }
      );
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: `Transcription Fon : "${transcription_fon}"` }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              comprehension_fr: { type: "STRING" },
              reponse_fr: { type: "STRING" },
              reponse_fon: { type: "STRING" },
            },
            required: ["comprehension_fr", "reponse_fr", "reponse_fon"],
          },
          temperature: 0.7,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("[GÉNÉRAL] Gemini error:", geminiRes.status, errText);
      return NextResponse.json(
        { error: `Erreur Gemini ${geminiRes.status}` },
        { status: 502 }
      );
    }

    const data = await geminiRes.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return NextResponse.json({ error: "Réponse Gemini vide." }, { status: 502 });
    }

    const parsed = JSON.parse(text) as {
      comprehension_fr: string;
      reponse_fr: string;
      reponse_fon: string;
    };

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[GÉNÉRAL] Erreur :", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne du serveur Général." },
      { status: 500 }
    );
  }
}
