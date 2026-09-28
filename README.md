# Handschriftlezer

Gratis handschrift-transcriptie voor NT2-docenten. Bezoekers vullen hun e-mailadres in, krijgen daarmee een beperkt aantal gratis transcripties, en zien daarna een link naar de cursus vibecoding.

## Projectstructuur

```
handschriftlezer/
├── server.js          ← backend (Node.js + Express): API, opslag e-mailadressen, aanroep Claude
├── package.json
├── .env.example       ← voorbeeld van de instellingen
├── data/emails.json   ← wordt automatisch aangemaakt: de verzamelde e-mailadressen
└── public/            ← frontend (wordt door de server geserveerd)
    ├── index.html     ← de pagina met alle teksten
    ├── styles.css
    └── app.js         ← e-mailformulier, upload, kopiëren, Word-download
```

De API-sleutel staat alleen op de server. De browser praat uitsluitend met je eigen server (`/api/register` en `/api/transcribe`) en ziet de sleutel nooit.

## Instellingen (environment variables)

| Variabele | Verplicht | Standaard | Betekenis |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ja | — | Je API-sleutel van [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `FREE_LIMIT` | nee | `3` | Aantal gratis transcripties per e-mailadres |
| `IP_DAILY_LIMIT` | nee | `15` | Maximaal aantal transcripties per IP-adres per 24 uur (tegen iemand die steeds een nieuw nep-adres invult) |
| `MODEL` | nee | `claude-opus-5` | Het Claude-model. `claude-sonnet-5` is goedkoper; test zelf of de kwaliteit dan genoeg is |
| `DATA_DIR` | nee | `./data` | Map waar `emails.json` komt te staan |
| `ADMIN_TOKEN` | nee | — | Geheim wachtwoord om je e-maillijst te downloaden (zie hieronder) |

## Lokaal draaien

1. Installeer [Node.js](https://nodejs.org) versie 20.12 of hoger (kies de "LTS"-versie).
2. Open een terminal in deze map en installeer de onderdelen:
   ```bash
   npm install
   ```
3. Maak je instellingenbestand:
   ```bash
   cp .env.example .env
   ```
   Open `.env` en vul achter `ANTHROPIC_API_KEY=` je eigen sleutel in.
4. Start de server:
   ```bash
   npm start
   ```
5. Open http://localhost:3000 in je browser.

`.env` staat in `.gitignore`, zodat je sleutel nooit per ongeluk op GitHub terechtkomt.

### Testen zonder API-sleutel (demomodus)

```bash
npm run demo
```

Alles werkt zoals normaal (e-mail, limiet, upload-controles, kopiëren, Word-download), maar in plaats van Claude aan te roepen krijg je na een paar seconden een vaste voorbeeldtekst terug. Er zijn dus geen kosten. Gebruik dit **nooit** op Render: zet daar geen `DEMO_MODE` in de instellingen.

## Online zetten op Render (aanbevolen)

Render draait een gewone Node-server en kan een vaste schijf koppelen, zodat je e-mailadressen bewaard blijven.

1. Zet deze map in een (privé) GitHub-repository.
2. Ga naar [render.com](https://render.com) → **New** → **Web Service** → kies je repository.
3. Instellingen:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Onder **Environment** voeg je toe: `ANTHROPIC_API_KEY` (je sleutel), `ADMIN_TOKEN` (een lang willekeurig wachtwoord) en `DATA_DIR` = `/var/data`.
5. Onder **Disks** voeg je een schijf toe met **Mount Path** `/var/data` (1 GB is ruim genoeg).

> **Let op:** op het gratis Render-abonnement is geen vaste schijf beschikbaar. Zonder schijf wordt `emails.json` gewist bij elke herstart of nieuwe versie, en daarmee ook de tellers per e-mailadres. Voor echte leadgeneratie heb je dus een betaald abonnement met schijf nodig (vanaf ca. $7 per maand).

## En Vercel?

Vercel werkt met serverless functies die geen bestanden kunnen bewaren. De JSON-opslag in dit project werkt daar dus **niet**: e-mailadressen en tellers verdwijnen. Wil je toch Vercel gebruiken, dan moet de opslag in `server.js` (de functies `loadStore` en `saveStore`) vervangen worden door een database zoals Vercel Postgres, Upstash Redis of Supabase. Render is voor dit project de snelste route.

## Je e-maillijst downloaden

Zet `ADMIN_TOKEN` in je instellingen en open daarna:

```
https://jouw-site.onrender.com/api/admin/emails.csv?token=JOUW_ADMIN_TOKEN
```

Je krijgt een CSV-bestand (te openen in Excel of te importeren in je mailprogramma) met e-mailadres, naam, aanmelddatum en het aantal gebruikte transcripties. Lokaal staat dezelfde lijst in `data/emails.json`.

## De cursuslink vervangen

In `public/index.html` staan twee plekken met een `TODO`-comment:

1. **De knop "Klik hier"** onder de tool (zoek op `TODO: vervang href="#cursus"`). Vervang `href="#cursus"` door de URL van je cursuspagina, bijvoorbeeld `href="https://jouwsite.nl/cursus"`.
2. **De placeholder-sectie** `<section id="cursus">` onderaan de pagina. Die kun je verwijderen zodra de knop naar je echte pagina wijst.

## Kostenbescherming

- Maximaal `FREE_LIMIT` transcripties per e-mailadres (een mislukte transcriptie telt niet mee).
- Maximaal `IP_DAILY_LIMIT` transcripties per IP-adres per 24 uur.
- Eén transcriptie tegelijk per e-mailadres.
- Alleen echte afbeeldingen (JPG, PNG, WEBP, GIF — gecontroleerd op de inhoud van het bestand, niet alleen de naam), maximaal 10 MB. Foto's worden in de browser eerst verkleind en op de server nooit opgeslagen.

Tip: stel in de [Anthropic Console](https://console.anthropic.com/settings/limits) ook een maandelijkse bestedingslimiet in. Dat is je laatste vangnet.

## Hoe de transcriptie werkt

`server.js` stuurt de foto naar Claude met de opdracht om de tekst **letterlijk** over te nemen, inclusief spel- en grammaticafouten van de leerling (die wil de docent juist beoordelen). Moeilijk leesbare woorden worden op basis van de context hersteld en tussen haken gezet, bijvoorbeeld `[boodschappen?]`, zodat de docent ziet welke woorden gecontroleerd moeten worden. De opdracht (`SYSTEM_PROMPT`) kun je bovenin `server.js` aanpassen.

Wordt een verzoek door het model geweigerd, dan probeert de API het automatisch opnieuw met een ander Claude-model (`fallbacks: "default"`).

## Teksten aanpassen en bijwerken op GitHub

Alle teksten van de pagina staan in `public/index.html`. Pas alleen de tekst tussen de tags aan, dus tussen `>` en `<`. Daarna:

```bash
npm run update -- "Korte omschrijving van je wijziging"
```

Dit zet al je wijzigingen op GitHub. Render zet ze daarna automatisch binnen een paar minuten live.
