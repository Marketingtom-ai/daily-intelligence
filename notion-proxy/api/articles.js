export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
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
      const res = await fetch(
        `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' } }
      );
      if (!res.ok) return '';
      const data = await res.json();
      let html = '';
      for (const block of data.results) {
        switch (block.type) {
          case 'paragraph':
            const pt = richTextToHtml(block.paragraph.rich_text);
            if (pt.trim()) html += `<p>${pt}</p>`;
            break;
          case 'heading_1':
            html += `<h2>${richTextToHtml(block.heading_1.rich_text)}</h2>`; break;
          case 'heading_2':
            html += `<h3>${richTextToHtml(block.heading_2.rich_text)}</h3>`; break;
          case 'heading_3':
            html += `<h4>${richTextToHtml(block.heading_3.rich_text)}</h4>`; break;
          case 'bulleted_list_item':
            html += `<ul><li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li></ul>`; break;
          case 'numbered_list_item':
            html += `<ol><li>${richTextToHtml(block.numbered_list_item.rich_text)}</li></ol>`; break;
          case 'quote':
            html += `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`; break;
        }
      }
      html = html.replace(/<\/ul>\s*<ul>/g,'').replace(/<\/ol>\s*<ol>/g,'');
      return html;
    } catch (e) {
      console.error('Error fetching blocks:', e);
      return '';
    }
  }

  function splitTitolo(raw) {
    const seps = [': ',' — ',' – ',' - '];
    for (const sep of seps) {
      const idx = raw.indexOf(sep);
      if (idx > 10 && idx < raw.length - 5) {
        return { titolo: raw.slice(0,idx).replace(/^OGGI:\s*/i,'').trim(), sottotitolo: raw.slice(idx+sep.length).trim() };
      }
    }
    return { titolo: raw.replace(/^OGGI:\s*/i,'').trim(), sottotitolo: '' };
  }

  function parseFonti(src) {
    if (!src) return [];
    const urlRe = /https?:\/\/[^\s,;)]+/g;
    const urls = src.match(urlRe) || [];
    return urls.slice(0,4).map((url,i) => {
      try { 
        const hostname = new URL(url).hostname.replace('www.','');
        return { nome: hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1), url };
      } catch { 
        return { nome: `Fonte ${i+1}`, url }; 
      }
    });
  }

  try {
    let pages = [], cursor;
    do {
      const body = { 
        page_size: 100, 
        sorts: [{ property: 'Data', direction: 'descending' }], 
        ...(cursor && { start_cursor: cursor }) 
      };
      
      const r = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Notion-Version': '2022-06-28', 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(body)
      });
      
      if (!r.ok) { 
        const e = await r.json(); 
        console.error('Notion API error:', e);
        return res.status(r.status).json(e); 
      }
      
      const d = await r.json();
      pages = pages.concat(d.results);
      cursor = d.has_more ? d.next_cursor : undefined;
    } while (cursor);

    const articles = await Promise.all(pages.map(async page => {
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
    }));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(articles.filter(a => a.titolo && a.contenuto));
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
