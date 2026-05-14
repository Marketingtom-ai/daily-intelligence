// api/articles.js
// Proxy Notion → restituisce gli articoli di Daily Intelligence
// Variabile d'ambiente richiesta su Vercel: NOTION_TOKEN

const DATABASE_ID = '3a146bf0c5264afbab74e9f2a59158f3';

// Converte un blocco Notion in testo HTML semplice
function richTextToHtml(richTextArray) {
  if (!richTextArray || !richTextArray.length) return '';
  return richTextArray
    .map(t => {
      let text = t.plain_text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (t.annotations?.bold)          text = `<strong>${text}</strong>`;
      if (t.annotations?.italic)        text = `<em>${text}</em>`;
      if (t.annotations?.code)          text = `<code>${text}</code>`;
      if (t.href)                        text = `<a href="${t.href}" target="_blank" rel="noopener">${text}</a>`;
      return text;
    })
    .join('');
}

// Converte i blocchi Notion in HTML
async function blocksToHtml(blockId, notionToken) {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      }
    }
  );
  if (!res.ok) return '';
  const data = await res.json();

  let html = '';
  for (const block of data.results) {
    switch (block.type) {
      case 'paragraph':
        const pText = richTextToHtml(block.paragraph.rich_text);
        if (pText.trim()) html += `<p>${pText}</p>`;
        break;
      case 'heading_1':
        html += `<h2>${richTextToHtml(block.heading_1.rich_text)}</h2>`;
        break;
      case 'heading_2':
        html += `<h3>${richTextToHtml(block.heading_2.rich_text)}</h3>`;
        break;
      case 'heading_3':
        html += `<h4>${richTextToHtml(block.heading_3.rich_text)}</h4>`;
        break;
      case 'bulleted_list_item':
        html += `<ul><li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li></ul>`;
        break;
      case 'numbered_list_item':
        html += `<ol><li>${richTextToHtml(block.numbered_list_item.rich_text)}</li></ol>`;
        break;
      case 'quote':
        html += `<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`;
        break;
      case 'divider':
        html += `<hr>`;
        break;
    }
  }

  // Consolida liste adiacenti
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  html = html.replace(/<\/ol>\s*<ol>/g, '');

  return html;
}

// Genera uno slug/id dal titolo
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

// Estrae le fonti dal campo Trend Source
function parseFonti(trendSource) {
  if (!trendSource) return [];
  const fonti = [];
  // Pattern: "NomeFonte (data)" o "NomeFonte - descrizione"
  // Cerca URL nel testo
  const urlRegex = /https?:\/\/[^\s,;)]+/g;
  const urls = trendSource.match(urlRegex) || [];
  const sources = trendSource.split(/[;,]/).map(s => s.trim()).filter(Boolean);

  sources.forEach((s, i) => {
    const urlMatch = s.match(urlRegex);
    const nome = s.replace(urlRegex, '').replace(/[-–]/g, '').trim().split(' ').slice(0, 4).join(' ');
    if (nome) {
      fonti.push({
        nome: nome || `Fonte ${i + 1}`,
        url: urlMatch ? urlMatch[0] : '#'
      });
    }
  });

  return fonti.slice(0, 4);
}

// Estrae titolo e sottotitolo (split sul ": " o "–")
function splitTitolo(titolo) {
  // Gestisce pattern "TITOLO PRINCIPALE: sottotitolo"
  const separators = [': ', ' — ', ' – ', ' - '];
  for (const sep of separators) {
    const idx = titolo.indexOf(sep);
    if (idx > 10 && idx < titolo.length - 5) {
      return {
        titolo: titolo.slice(0, idx).replace(/^OGGI:\s*/i, '').trim(),
        sottotitolo: titolo.slice(idx + sep.length).trim()
      };
    }
  }
  return { titolo: titolo.replace(/^OGGI:\s*/i, '').trim(), sottotitolo: '' };
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) {
    res.status(500).json({ error: 'NOTION_TOKEN non configurato nelle variabili d\'ambiente Vercel.' });
    return;
  }

  try {
    // 1. Recupera tutte le pagine dal database Notion
    let allPages = [];
    let cursor = undefined;

    do {
      const body = {
        page_size: 100,
        sorts: [{ property: 'Data', direction: 'descending' }],
        ...(cursor && { start_cursor: cursor })
      };

      const dbRes = await fetch(
        `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        }
      );

      if (!dbRes.ok) {
        const err = await dbRes.json();
        res.status(dbRes.status).json({ error: 'Notion API error', details: err });
        return;
      }

      const dbData = await dbRes.json();
      allPages = allPages.concat(dbData.results);
      cursor = dbData.has_more ? dbData.next_cursor : undefined;
    } while (cursor);

    // 2. Trasforma ogni pagina in un articolo
    const articles = await Promise.all(
      allPages.map(async (page) => {
        const props = page.properties;

        // Titolo completo dalla property Titolo
        const titoloRaw = props.Titolo?.title?.map(t => t.plain_text).join('') || '';
        const { titolo, sottotitolo } = splitTitolo(titoloRaw);

        // Categoria
        const categoria = props.Categoria?.select?.name || 'News';

        // Data
        const data = props.Data?.date?.start || page.created_time?.slice(0, 10) || '';

        // Trend Source
        const trendSource = props['Trend Source']?.rich_text?.map(t => t.plain_text).join('') || '';

        // Contenuto: prima prova dalla property Contenuto, poi dai blocchi della pagina
        let contenuto = props.Contenuto?.rich_text?.map(t => t.plain_text).join('') || '';
        if (!contenuto.trim()) {
          contenuto = await blocksToHtml(page.id, notionToken);
        } else {
          // Wrappa paragrafi se è testo plain
          contenuto = contenuto
            .split(/\n\n+/)
            .filter(p => p.trim())
            .map(p => `<p>${p.replace(/\n/g, ' ').trim()}</p>`)
            .join('');
        }

        // ID stabile basato sull'ID Notion
        const id = page.id.replace(/-/g, '').slice(0, 16);

        return {
          id,
          notion_id: page.id,
          titolo,
          sottotitolo,
          categoria,
          data,
          trend_source: trendSource,
          contenuto,
          fonti: parseFonti(trendSource),
          url: page.url
        };
      })
    );

    // 3. Filtra articoli senza contenuto
    const validArticles = articles.filter(a => a.titolo && a.contenuto);

    res.status(200).json(validArticles);

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Errore interno', message: err.message });
  }
}
