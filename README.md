# 🎙️ Speeckle — Pipeline ASR · Général · TTS pour la langue Fon

Interface de test pour les modèles de traitement de la parole Fon développés par ton équipe.

## Architecture

```
🎤 Voix utilisateur
     │
     ▼
┌─────────────┐      ┌─────────────────┐      ┌─────────────┐
│   ASR Panel  │ ──→  │  Général Panel  │ ──→  │  TTS Panel  │
│             │      │                 │      │             │
│ Enregistre  │      │ Comprend le Fon │      │ Synthétise  │
│ la voix et  │      │ Génère réponse  │      │ le texte Fon│
│ transcrit   │      │ FR + Fon        │      │ en audio    │
│ en Fon      │      │                 │      │             │
└─────────────┘      └─────────────────┘      └─────────────┘
     │                      │                       │
     ▼                      ▼                       ▼
/api/asr              /api/general             /api/tts
```

## Installation

```bash
cd speeckle
pnpm install
cp .env.example .env.local
# Édite .env.local avec tes vraies valeurs
pnpm dev
```

Ouvre [http://localhost:3000](http://localhost:3000)

## Connecter tes modèles

### 1. Modèle ASR (`app/api/asr/route.ts`)

**Entrée :** `FormData` avec un champ `audio` (Blob webm/wav)  
**Sortie :** `{ transcription: string }`

```typescript
// Exemple HuggingFace Inference API
const response = await fetch(
  `https://api-inference.huggingface.co/models/${process.env.ASR_MODEL_ID}`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
    body: audioBuffer,
  }
);
const { text } = await response.json();
return NextResponse.json({ transcription: text });
```

### 2. Modèle Général (`app/api/general/route.ts`)

**Entrée :** `{ transcription_fon: string }`  
**Sortie :** `{ comprehension_fr: string, reponse_fr: string, reponse_fon: string }`

```typescript
// Exemple API interne FastAPI
const response = await fetch(`${process.env.GENERAL_MODEL_URL}/predict`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: transcription_fon }),
});
const data = await response.json();
return NextResponse.json({
  comprehension_fr: data.comprehension,
  reponse_fr: data.response_fr,
  reponse_fon: data.response_fon,
});
```

### 3. Modèle TTS (`app/api/tts/route.ts`)

**Option A — Retourner un buffer audio directement :**
```typescript
const audioBuffer = await fetch(TTS_API_URL, { body: text_fon }).then(r => r.arrayBuffer());
return new NextResponse(audioBuffer, {
  headers: { "Content-Type": "audio/wav" },
});
```

**Option B — Retourner base64 JSON :**
```typescript
return NextResponse.json({
  audio_base64: "...",
  mime_type: "audio/wav"
});
```

## Stack

- **Next.js 15** — App Router + API Routes
- **TailwindCSS 3** — Styling
- **Hugeicons React** — Icônes
- **Web Audio API** — Enregistrement microphone + lecture audio
- **MediaRecorder API** — Capture audio webm

## Structure

```
speeckle/
├── app/
│   ├── api/
│   │   ├── asr/route.ts        ← 🔧 Branche ton modèle ASR ici
│   │   ├── general/route.ts    ← 🔧 Branche ton modèle Général ici
│   │   └── tts/route.ts        ← 🔧 Branche ton modèle TTS ici
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ASRPanel.tsx
│   ├── GeneralPanel.tsx
│   ├── TTSPanel.tsx
│   └── FlowConnector.tsx
├── .env.example
└── README.md
```
