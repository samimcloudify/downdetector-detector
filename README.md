# Detect the Downdetector

We watch the watchmen. Powered by KLOUD MSP.

## Files
- `index.html` – the page
- `api/check.js` – Vercel serverless function that checks downdetector.com from the server every time it's called (cached 20s)

## Deploy (Vercel)
1. Push this folder to a GitHub repo.
2. Vercel → Add New → Project → import the repo → Deploy (no framework, no build command).
3. Settings → Domains → add your domain / subdomain and create the CNAME it shows.

Test: open `https://<your-domain>/api/check` – you should see JSON like
`{"status":"up","reason":"HTTP 200",...}`.

## Optional: 24/7 alerts
Add a free UptimeRobot "Keyword" monitor on `https://<your-domain>/api/check`,
alert when the keyword `"status":"down"` appears.
