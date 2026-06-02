export default async function handler(req, res) {
  // Dominio pubblico del sito (dove vivono blog.html e article.html)
  const SITE_URL = 'https://markettistianonimi.it';

  // Costruisce l'URL della API articoli a partire dall'host corrente,
  // cosi' il sitemap usa SEMPRE la stessa fonte del blog (zero disallineamenti).
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const apiUrl = `${proto}://${host}/api/articles`;

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const r = await fetch(apiUrl);
    if (!r.ok) throw new Error('Articles API returned ' + r.status);
    const articles = await r.json();

    const urls = [];

    // 1) Pagina indice del blog
    urls.push(
      '  <url>\n' +
      '    <loc>' + SITE_URL + '/blog.html</loc>\n' +
      '    <lastmod>' + today + '</lastmod>\n' +
      '    <changefreq>daily</changefreq>\n' +
      '    <priority>1.0</priority>\n' +
      '  </url>'
    );

    // 2) Un <url> per ogni articolo
    for (const a of articles) {
      if (!a || !a.id) continue;
      const lastmod = (a.data && /^\d{4}-\d{2}-\d{2}/.test(a.data))
        ? a.data.slice(0, 10)
        : today;
      const loc = SITE_URL + '/article.html?id=' + encodeURIComponent(a.id);
      urls.push(
        '  <url>\n' +
        '    <loc>' + xmlEscape(loc) + '</loc>\n' +
        '    <lastmod>' + lastmod + '</lastmod>\n' +
        '    <changefreq>weekly</changefreq>\n' +
        '    <priority>0.8</priority>\n' +
        '  </url>'
      );
    }

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') + '\n' +
      '</urlset>';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Cache 1h sul CDN, serve la versione vecchia mentre rigenera (fino a 24h)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (err) {
    console.error('Sitemap error:', err.message);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(500).send(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
    );
  }
}
