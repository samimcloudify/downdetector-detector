// Vercel serverless function: GET /api/check
// Checks downdetector.com from the server, where the real HTTP status code is visible
// (a browser can't see it because of cross-origin rules).
//
// Result: { status: "up" | "down" | "unknown", code, ms, reason, checkedAt }
//   up      = Downdetector answered normally (2xx/3xx), or answered with a bot check (still alive)
//   down    = 5xx error, Cloudflare error page, timeout, or DNS/connection failure
//   unknown = our own server couldn't reach the internet either (our problem, not theirs)

const TARGET = "https://downdetector.com/";
const CONTROL = "https://www.google.com/generate_204";
const TIMEOUT_MS = 8000;
const UA = "DetectTheDowndetector/1.0 (+https://kloudmsp.com)";

async function timedFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      cache: "no-store",
    });
    // Read a little of the body so we can spot Cloudflare error pages, then stop.
    let snippet = "";
    try {
      const text = await res.text();
      snippet = text.slice(0, 4000);
    } catch (_) {}
    return { ok: true, code: res.status, headers: res.headers, snippet, ms: Date.now() - t0 };
  } catch (err) {
    const timeout = err && err.name === "AbortError";
    return { ok: false, timeout, error: String((err && err.cause && err.cause.code) || (err && err.message) || err), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function classify(r) {
  if (!r.ok) return { status: "down", reason: r.timeout ? "timed out" : "unreachable (" + r.error + ")" };

  const code = r.code;
  const h = (k) => (r.headers && r.headers.get(k)) || "";
  const body = (r.snippet || "").toLowerCase();

  // Cloudflare bot check / rate limit: the site is alive, it just doesn't like robots.
  const challenged =
    h("cf-mitigated") === "challenge" ||
    body.includes("just a moment") ||
    body.includes("challenges.cloudflare.com") ||
    body.includes("cf-chl");
  if ((code === 403 || code === 429 || code === 503) && challenged) {
    return { status: "up", reason: "alive (behind a bot check)" };
  }

  // Server errors, including Cloudflare's own 52x codes = down.
  if (code >= 500) return { status: "down", reason: "HTTP " + code };

  // Cloudflare sometimes serves its error page with an odd code; catch it by content.
  if (code >= 400 && body.includes("cloudflare") && (body.includes("error code") || body.includes("internal server error") || body.includes("bad gateway"))) {
    return { status: "down", reason: "Cloudflare error page (HTTP " + code + ")" };
  }

  if (code >= 200 && code < 400) return { status: "up", reason: "HTTP " + code };

  // Other 4xx (404, 403 without a challenge…) = it answered, so it's alive, just grumpy.
  return { status: "up", reason: "answered with HTTP " + code };
}

module.exports = async (req, res) => {
  const [target, control] = await Promise.all([timedFetch(TARGET), timedFetch(CONTROL)]);
  let result = classify(target);

  // If Downdetector looks down AND we can't reach Google either, the problem is on our side.
  if (result.status === "down" && !control.ok) {
    result = { status: "unknown", reason: "our server can't reach the internet either" };
  }

  // Cache at Vercel's edge for 20s so lots of visitors don't hammer Downdetector.
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=10");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).send(
    JSON.stringify({
      status: result.status,
      reason: result.reason,
      code: target.code || null,
      ms: target.ms,
      region: process.env.VERCEL_REGION || null,
      checkedAt: new Date().toISOString(),
    })
  );
};

module.exports.classify = classify;
