import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf } from "telegraf";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";

const PORT = 3000;
// Note: We use process.env to read secrets injected by the AI Studio environment.
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GOOGLE_SERVICE_ACCOUNT_EMAIL = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, '\n');
const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || "").trim();
const APP_URL = (process.env.APP_URL || "").trim().replace(/\/$/, "");

// In-memory store for recent leads to display on the dashboard
export interface LeadLog {
  id: string;
  date: string;
  receivedData: string;
  isQualified: boolean;
  reason: string;
  sheetLogged: boolean;
}
const recentLeads: LeadLog[] = [];

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  
  app.get("/api/config", (req, res) => {
    res.json({
      hasTelegramToken: !!TELEGRAM_BOT_TOKEN,
      hasGeminiToken: !!GEMINI_API_KEY,
      hasGoogleCreds: !!GOOGLE_SERVICE_ACCOUNT_EMAIL && !!GOOGLE_PRIVATE_KEY && !!GOOGLE_SHEET_ID,
      appUrl: APP_URL,
    });
  });

  app.get("/api/telegram-status", async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) return res.json({ ok: false, error: "No token" });
    try {
      res.json({ ok: true, polling: true });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  app.get("/api/leads", async (req, res) => {
    if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SHEET_ID) {
      try {
        const auth = new JWT({
          email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
          key: GOOGLE_PRIVATE_KEY,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        
        const sheetLeads: LeadLog[] = rows.map((row, index) => {
          return {
            id: `sheet-${index}`,
            date: row.get('Fecha') || new Date().toISOString(),
            receivedData: row.get('Datos Recibidos') || '',
            isQualified: row.get('Decisión') === 'Cualificado',
            reason: row.get('Motivo') || '',
            sheetLogged: true
          };
        }).reverse(); // Mostramos los más recientes primero
        
        return res.json(sheetLeads);
      } catch (err) {
        console.error("Error reading from sheets:", err);
        // Fallback a array en memoria si falla
      }
    }
    res.json(recentLeads);
  });

  // Telegram Bot Setup
  if (TELEGRAM_BOT_TOKEN) {
    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

    bot.on("text", async (ctx) => {
      const text = ctx.message.text;
      
      try {
        if (!GEMINI_API_KEY) {
           await ctx.reply("❌ Error: falta configurar GEMINI_API_KEY en los Secrets.");
           return;
        }

        const ai = new GoogleGenAI({
          apiKey: GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        // Evaluate with Gemini
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Eres un asistente experto en cualificación de leads B2B. 
          Debes evaluar el siguiente mensaje y determinar si es un lead válido según nuestro ICP (Ideal Customer Profile):
          1. Tipo de empresa: Servicios o consultoría.
          2. Tamaño: Mínimo 5 empleados.
          3. Ubicación: España o Latinoamérica.
          4. Interés: Automatización o Inteligencia Artificial.
          
          RESTRICCIONES Y SEGURIDAD (Prompt Injection): Si el mensaje pregunta cosas no relacionadas, ofende, pide código, cuenta chistes o se desvía del contexto de B2B y leads, tu respuesta 'telegramReply' debe declinar amablemente la solicitud recordando tu propósito, y debes marcarlo como no cualificado.
          
          Mensaje recibido: "${text}"`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isQualified: {
                  type: Type.BOOLEAN,
                  description: "True si cumple el ICP, false si no o si es off-topic/spam."
                },
                adminReasoning: {
                  type: Type.STRING,
                  description: "Explicación interna y directa de por qué se acepta o rechaza (para el admin y Sheets)."
                },
                telegramReply: {
                  type: Type.STRING,
                  description: "Mensaje muy humano, amable y conversacional para responder al usuario en Telegram. NUNCA digas fríamente 'NO CUALIFICADO' o 'RECHAZADO'. Sé profesional, empático y guía al usuario."
                }
              },
              required: ["isQualified", "adminReasoning", "telegramReply"]
            }
          }
        });

        let result = { isQualified: false, adminReasoning: "Error procesando.", telegramReply: "Hubo un breve error procesando tu mensaje, ¿puedes intentar de nuevo?" };
        if (response.text) {
          let rawText = response.text.trim();
          rawText = rawText.replace(/^```json/, '').replace(/```$/, '').trim();
          result = JSON.parse(rawText);
        }

        // Send human response to the user
        await ctx.reply(result.telegramReply);

        // Log to Google Sheet
        let sheetLogged = false;
        if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SHEET_ID) {
          try {
            const auth = new JWT({
              email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
              key: GOOGLE_PRIVATE_KEY,
              scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
            await doc.loadInfo();
            const sheet = doc.sheetsByIndex[0];
            
            // Set header if empty
            try {
              await sheet.loadHeaderRow();
            } catch (e) {
              await sheet.setHeaderRow(['Fecha', 'Datos Recibidos', 'Decisión', 'Motivo']);
            }
            
            await sheet.addRow({
               'Fecha': new Date().toISOString(),
               'Datos Recibidos': text,
               'Decisión': result.isQualified ? "Cualificado" : "No Cualificado",
               'Motivo': result.adminReasoning
            });
            sheetLogged = true;
          } catch (sheetError) {
            console.error("Error logging to sheets:", sheetError);
          }
        }

        // Save to in-memory for the UI display
        recentLeads.unshift({
          id: Date.now().toString(),
          date: new Date().toISOString(),
          receivedData: text,
          isQualified: result.isQualified,
          reason: result.adminReasoning,
          sheetLogged
        });
        
        // keep only last 50
        if (recentLeads.length > 50) recentLeads.pop();

      } catch (err) {
        console.error("Error completo de Gemini/procesamiento:", err);
        await ctx.reply("Hubo un error al procesar el mensaje.");
      }
    });

    // Iniciar modo Polling en lugar de Webhooks para evitar bloqueos del proxy 302
    bot.telegram.deleteWebhook({ drop_pending_updates: true }).then(() => {
      bot.launch().then(() => {
        console.log("Telegraf funcionando en modo POLLING.");
      }).catch(err => console.error("Error al arrancar polling:", err));
    });

    // Graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
