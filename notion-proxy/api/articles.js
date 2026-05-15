export default async function handler(req, res) {
  console.log('=== API Call Started ===');
  console.log('Method:', req.method);
  console.log('Token exists:', !!process.env.NOTION_TOKEN);

  // ── CORS headers — devono stare PRIMA di qualsiasi res.status() ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error('ERROR: NOTION_TOKEN not set');
    return res.status(500).json({ error: 'NOTION_TOKEN non configurato' });
  }

  const DATABASE_ID = '3a146bf0c5264afbab74e9f2a59158f3';

  function richTextToHtml(arr) {
    if (!arr || !arr.length) return '';
    return arr.map(t => {
      let text = (t.plain_text || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      if (t.annotations?.bold)   text = `<strong>${text}</strong>`;
      if (t.annotations?.italic) text = `<em>${text}</em>`;
      if (t.annotations?.code)   text = `<code>${text}</code>`;
      if (t.href)                text = `<a href="${t.href}" target="_blank" rel="noopener">${text}</a>`;
      return text;
    }).join('');
  }

  async function blocksToHtml(pageId) {
    try {
      const r = await fetch(
        `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28'
          }
        }
      );
      if (!r.ok) {
        console.warn(`Blocks fetch failed for ${pageId}:`, r.status);
        return '';
      }
      const data = await r.json();
      let html = '';
      for (const block of data.results) {
        if (block.type === 'paragraph') {
          const pt = richTextToHtml(block.paragraph.rich_text);
          if (pt.trim()) html += `<p>${pt}</p>`;
        } else if (block.type === 'heading_1') {
          html += `<h2>${richTextToHtml(block.heading_1.rich_text)}</h2>`;
        } else if (block.type === 'heading_2') {
          html += `<h3>${richTextToHtml(block.heading_2.rich_text)}</h3>`;
        } else if (block.type === 'heading_3') {
          html += `<h4>${richTextToHtml(block.heading_3.rich_text)}</h4>`;
        } else if (block.type === 'bulleted_list_item') {
          html += `<ul><li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li></ul>`;
        } else if (block.type === 'numbered_list_item') {
          html += `<ol><li>${richTextToHtml(block.numbered_list_item.rich_text)}</li></ol>`;
        } else if (block.type === 'quote') {
          html += `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`;
        }
      }
      html = html.replace(/<\/ul>\s*<ul>/g,'').replace(/<\/ol>\s*<ol>/g,'');
      return html;
    } catch (e) {
      console.error('Error fetching blocks:', e.message);
      return '';
    }
  }

  function splitTitolo(raw) {
    const seps = [': ',' — ',' – ',' - '];
    for (const sep of seps) {
      const idx = raw.indexOf(sep);
      if (idx > 10 && idx < raw.length - 5) {
        return {
          titolo: raw.slice(0,idx).replace(/^OGGI:\s*/i,'').trim(),
          sottotitolo: raw.slice(idx+sep.length).trim()
        };
      }
    }
    return {
      titolo: raw.replace(/^OGGI:\s*/i,'').trim(),
      sottotitolo: ''
    };
  }

  function parseFonti(src) {
    if (!src) return [];
    const urlRe = /https?:\/\/[^\s,;)]+/g;
    const urls = src.match(urlRe) || [];
    return urls.slice(0,4).map((url,i) => {
      try {
        const hostname = new URL(url).hostname.replace('www.','');
        return { nome: hostname.split('.')[0], url };
      } catch {
        return { nome: `Fonte ${i+1}`, url };
      }
    });
  }

  try {
    console.log('Starting Notion API call for database:', DATABASE_ID);

    let pages = [], cursor;
    let hasMore = true;

    while (hasMore) {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Data', direction: 'descending' }],
        ...(cursor && { start_cursor: cursor })
      };

      console.log('Fetching pages with cursor:', cursor ? 'yes' : 'no');

      const r = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      console.log('Notion API response status:', r.status);

      if (!r.ok) {
        const e = await r.json();
        console.error('Notion API error:', JSON.stringify(e));
        return res.status(r.status).json({
          error: 'Notion API error',
          details: e,
          status: r.status
        });
      }

      const d = await r.json();
      console.log('Got', d.results.length, 'results');
      pages = pages.concat(d.results);
      hasMore = d.has_more;
      cursor = d.next_cursor;
    }

    console.log('Total pages fetched:', pages.length);

    const articles = await Promise.all(pages.map(async (page, idx) => {
      try {
        const props = page.properties;
        const raw = props.Titolo?.title?.map(t => t.plain_text).join('') || '';
        const { titolo, sottotitolo } = splitTitolo(raw);
        const categoria = props.Categoria?.select?.name || 'News';
        const data = props.Data?.date?.start || page.created_time?.slice(0,10) || '';
        const trendSource = props['Trend Source']?.rich_text?.map(t => t.plain_text).join('') || '';

        let contenuto = props.Contenuto?.rich_text?.map(t => t.plain_text).join('') || '';
        if (!contenuto.trim()) {
          contenuto = await blocksToHtml(page.id);
        } else {
          contenuto = contenuto.split(/\n\n+/).filter(p=>p.trim()).map(p=>`<p>${p.trim()}</p>`).join('');
        }

        return {
          id: page.id.replace(/-/g,'').slice(0,16),
          notion_id: page.id,
          titolo, sottotitolo, categoria, data,
          trend_source: trendSource,
          contenuto,
          fonti: parseFonti(trendSource)
        };
      } catch (e) {
        console.error(`Error processing page ${idx}:`, e.message);
        return null;
      }
    }));

    const filtered = articles.filter(a => a && a.titolo && a.contenuto);
    console.log('Final articles after filtering:', filtered.length);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(filtered);

  } catch (err) {
    console.error('=== HANDLER ERROR ===');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({
      error: 'Server error',
      message: err.message
    });
  }
}
