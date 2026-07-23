# Paperflow

Paperflow turns a phone photo of an attendance sheet into editable rows, then exports them to Google Sheets or an Excel-compatible CSV. It detects the printed headers on each form, so event layouts can use different columns.

Each photo can use either:

- **PaddleOCR** — free, private, and local; best for printed text.
- **OpenAI Vision** — higher accuracy for difficult handwriting; the photo is sent to OpenAI and API usage charges apply.

Written cells should still be reviewed before export.

## Start Paperflow

For the simplest startup, open PowerShell in this folder and run:

```powershell
npm.cmd run dev:all
```

Then open `http://localhost:3000`.

To stop both services:

```powershell
npm.cmd run stop
```

You can also run the services separately in two terminals:

```powershell
npm.cmd run dev:ocr
npm.cmd run dev
```

Open the local address shown in Terminal 2. On a phone connected to the same Wi-Fi, use the computer's local network address instead of `localhost`.

The first OCR launch installs its Python packages and downloads its models. Later launches reuse those files. Keep Terminal 1 open while reading photos.

## Workflow

1. Take or choose a clear, straight-on photo with the full sheet visible.
2. Choose free local PaddleOCR or higher-accuracy OpenAI Vision.
3. Choose Google Sheets or Excel.
4. Review the detected event details, dynamic columns, and attendee rows.
5. Correct handwriting mistakes or highlighted blank cells.
6. Export to a new formatted Google Sheet or download the Excel-compatible CSV.

Google Sheets sign-in uses the public OAuth client ID in `.env.local`; no Google client secret is required. The local file is ignored by Git.

To enable OpenAI Vision, create a new API key and add these server-only values to `.env.local`:

```dotenv
OPENAI_API_KEY=your-new-openai-project-api-key
OPENAI_VISION_MODEL=gpt-5.6-luna
```

Never prefix the key with `NEXT_PUBLIC_` and do not paste it into chat or source files. Restart Paperflow after changing `.env.local`. OpenAI API billing is separate from a ChatGPT subscription.

## Checks

```powershell
npm.cmd run build
```

The local OCR service exposes a health check at `http://127.0.0.1:8765/health`.
