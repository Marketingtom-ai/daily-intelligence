const axios = require('axios');
require('dotenv').config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Funzione per cercare news su web (simula una ricerca)
async function searchNews() {
  const today = new Date().toLocaleDateString('it-IT');
  
  const newsContext = `
    Oggi è ${today}. Genera 3 Daily Intelligence completamente diverse per Markettisti Anonimi.
    
    Ogni contenuto deve:
    1. Essere operativo e applicabile subito (non generico)
    2. Avere uno di questi tipi:
       - 📰 NEWS MARKETING & AI (notizie rilevanti ultime 24h)
       - ⚙️ STRATEGIE DI MARKETING OPERATIVE (framework, tattiche applicabili)
       - 📈 ADS & PERFORMANCE MARKETING (ottimizzazioni, trend)
       - 🧠 PRODUCTIVITY & AI TOOLS (tool, automazioni, workflow)
       - ⚡ SKILL OPERATIVE (prompt, sistemi, workflow AI)
    3. Contenere almeno 1 insight non ovvio
    4. Avere applicazione concreta entro 24 ore
    5. Essere scritto da chi lavora sul campo (no blog template, no frasi motivazionali vuote)
    
    Puoi usare trend attuali, best practice evergreen aggiornate, case study reali o pattern operativi.
    Non inventare notizie false - puoi citare trend reali o framework consolidati.
    
    Per ogni contenuto, fornisci un JSON con:
    {
      "titolo": "Titolo forte e specifico",
      "categoria": "News | Strategy | Ads | Tool | Skill",
      "contenuto": "Contenuto completo in markdown",
      "trend_source": "Breve nota su cosa ha attivato il contenuto"
    }
    
    Rispondi con un array JSON di 3 oggetti.
  `;
  
  return newsContext;
}

// Funzione per chiamare Claude API e generare contenuti
async function generateDailyIntelligence() {
  try {
    const newsContext = await searchNews();
    
    console.log('🚀 Generating Daily Intelligence...');
    
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: newsContext
        }
      ]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    
    // Estrai il testo dalla risposta
    const responseText = response.data.content[0].text;
    
    // Parse JSON dalla risposta
    let dailyIntelligences = [];
    try {
      // Cerca JSON nell'output
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        dailyIntelligences = JSON.parse(jsonMatch[0]);
      } else {
        console.error('❌ Could not find JSON in response');
        return [];
      }
    } catch (parseError) {
      console.error('❌ Error parsing JSON from Claude response:', parseError);
      console.log('Raw response:', responseText);
      return [];
    }
    
    console.log(`✅ Generated ${dailyIntelligences.length} Daily Intelligence items`);
    return dailyIntelligences;
    
  } catch (error) {
    console.error('❌ Error generating content:', error.message);
    if (error.response?.data) {
      console.error('API Response:', error.response.data);
    }
    return [];
  }
}

// Funzione per salvare su Notion
async function saveToNotion(dailyIntelligences) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    for (const item of dailyIntelligences) {
      const payload = {
        parent: {
          database_id: NOTION_DATABASE_ID
        },
        properties: {
          'Titolo': {
            title: [
              {
                text: {
                  content: item.titolo
                }
              }
            ]
          },
          'Data': {
            date: {
              start: today
            }
          },
          'Categoria': {
            select: {
              name: mapCategory(item.categoria)
            }
          },
          'Trend Source': {
            rich_text: [
              {
                text: {
                  content: item.trend_source
                }
              }
            ]
          }
        },
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  text: {
                    content: item.contenuto
                  }
                }
              ]
            }
          }
        ]
      };
      
      const response = await axios.post(
        'https://api.notion.com/v1/pages',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`✅ Saved to Notion: ${item.titolo}`);
    }
    
    console.log('✅ All Daily Intelligence saved to Notion');
    
  } catch (error) {
    console.error('❌ Error saving to Notion:', error.message);
    if (error.response?.data) {
      console.error('Notion Response:', error.response.data);
    }
  }
}

// Mapping categorie da testo a select values Notion
function mapCategory(category) {
  const mapping = {
    'News': 'News',
    'Strategy': 'Strategy',
    'Ads': 'Ads',
    'Tool': 'Tool',
    'Skill': 'Skill'
  };
  return mapping[category] || 'Strategy';
}

// Main
async function main() {
  console.log('📅 Starting Daily Intelligence generation...');
  const dailyIntelligences = await generateDailyIntelligence();
  
  if (dailyIntelligences.length > 0) {
    await saveToNotion(dailyIntelligences);
  } else {
    console.log('⚠️ No Daily Intelligence generated');
  }
}

main().catch(console.error);
