# 전쟁과 평화 리더

A Kindle-style web reader for the modern Korean translation of *War and Peace*.
No dependencies: a small Node server (`server.js`) serves the static reader in `public/`.

## Reading controls

- Tap the right side of the page (or swipe left, or press →/Space) for the next page; tap the left side (or swipe right, or press ←) to go back.
- Tap the middle of the page to show the toolbars: contents (☰), display settings (가가), bookmark (ribbon), and a slider to jump anywhere in the book.
- Tap the bottom status line to switch between pages left in the chapter, time left in the chapter, time left in the book, and location.
- Your place, settings and bookmarks are saved in the browser, so reopening the page brings you back where you stopped.

## Run locally

```
npm start            # http://localhost:3000
```

## Deploy on Railway

1. Put this folder in a GitHub repository (the folder contents at the repo root).
2. In Railway: **New Project → Deploy from GitHub repo**, and pick that repository.
3. Railway detects Node and runs `npm start` (also set in `railway.json`, with a `/healthz` health check). No environment variables are needed; Railway provides `PORT`.
4. Open the service's **Settings → Networking → Generate Domain** to get a public URL.

## Updating the text

The source text lives in `book/` (one file per book, chapters headed `제N장`).
After editing it, run `npm run build-data` to regenerate `public/data/`, then commit and push.
