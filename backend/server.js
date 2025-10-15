import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, 'data', 'preguntas.json');
// Config desde .env
dotenv.config();
const USE_DB = process.env.USE_DB === 'true';
let dbPool = null;

async function initDb() {
  if (!USE_DB) return;
  if (dbPool) return;
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306;
  const dbUser = process.env.DB_USER || 'root';
  const dbPass = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || '';

  dbPool = await mysql.createPool({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
}

async function loadQuestionsFromDb() {
  if (!dbPool) await initDb();
  if (!dbPool) throw new Error('DB pool no inicializado');

  // Leemos preguntas y sus opciones
  const [preguntasRows] = await dbPool.query('SELECT id, titulo_id, texto, epigrafe, pagina_pdf, pagina_bop, explicacion, respuesta_correcta FROM preguntas');
  // Para evitar muchas queries, leer todas las opciones y agrupar
  const [opcionesRows] = await dbPool.query('SELECT id, pregunta_id, texto, es_correcta FROM opciones');

  const opcionesPorPregunta = opcionesRows.reduce((acc, opt) => {
    (acc[opt.pregunta_id] = acc[opt.pregunta_id] || []).push({ id: opt.id, text: opt.texto, is_correct: !!opt.es_correcta });
    return acc;
  }, {});

  const normalized = preguntasRows.map(row => ({
    id: row.id,
    titulo_id: row.titulo_id,
    text: row.texto,
    epigrafe: row.epigrafe,
    pagina_pdf: row.pagina_pdf,
    pagina_bop: row.pagina_bop,
    explanation: row.explicacion,
    answerText: row.respuesta_correcta,
    options: opcionesPorPregunta[row.id] || []
  }));

  return normalized;
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

function loadQuestions() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const arr = JSON.parse(raw);
  // Normalización y validación mínima (más tolerante que antes)
  const normalized = arr.map((q) => {
    if (!Array.isArray(q.options)) return q;

    // Asegurarnos de que is_correct es booleano cuando exista
    q.options = q.options.map(o => ({ ...o, is_correct: !!o.is_correct }));

    const markedCorrect = q.options.filter(o => o.is_correct === true);

    // Caso ideal: exactamente una opción marcada y coincide con q.answer (si existe)
    if (markedCorrect.length === 1 && (!q.answer || q.answer === markedCorrect[0].text)) {
      return q;
    }

    // Intentar reconciliar por texto si q.answer está presente
    if (q.answer) {
      const matchByText = q.options.find(o => (o.text || o.label || '').trim() === String(q.answer).trim());
      if (matchByText) {
        // Marcar solo esa opción como correcta
        q.options = q.options.map(o => ({ ...o, is_correct: o === matchByText }));
        return q;
      }
    }

    // Si hay exactamente una opción marcada pero su texto no coincide con answer, avisar y mantener la marca
    if (markedCorrect.length === 1) {
      console.warn(`Pregunta ${q.id}: opción marcada como correcta (${markedCorrect[0].text}) no coincide con answer (${q.answer}). Usando la marca existente.`);
      return q;
    }

    // Si hay múltiples o ninguna marcada y no encontramos coincidencia, no lanzamos error: dejamos is_correct tal cual
    // y avisamos en logs para que el autor del JSON pueda corregirlo.
    console.warn(`Pregunta ${q.id}: incoherencia entre options.is_correct y answer. Ninguna reconciliación automática posible; continuando sin lanzar excepción.`);
    return q;
  });

  return normalized;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

let CACHE = null;

app.get('/api/questions', async (_req, res) => {
  try {
    if (USE_DB) {
      // cargar desde DB (no cache por ahora o cache si lo prefieres)
      const rows = await loadQuestionsFromDb();
      const randomized = rows.map(q => ({ ...q, options: shuffle((q.options || []).slice()) }));
      const sanitized = randomized.map(q => ({ ...q, options: q.options.map(o => ({ text: o.text })) }));
      return res.json({ count: sanitized.length, questions: sanitized });
    }

    if (!CACHE) CACHE = loadQuestions();
    const randomized = CACHE.map(q => ({ ...q, options: shuffle(q.options.slice()) }));
    const sanitized = randomized.map(q => ({ ...q, options: q.options.map(o => ({ text: o.text })) }));
    return res.json({ count: sanitized.length, questions: sanitized });
  } catch (err) {
    console.error('Error cargando preguntas:', err);
    return res.status(500).json({ error: 'Error al cargar preguntas' });
  }
});

app.post('/api/submit', (req, res) => {
  if (!CACHE) CACHE = loadQuestions();
  const answers = req.body?.answers || {}; // { "id": "texto opción elegida" }
  let correct = 0;

  const breakdown = CACHE.map(q => {
    const user = answers[String(q.id)] ?? null;
    const correctOpt = q.options.find(o => o.is_correct);
    const ok = user === (correctOpt?.text ?? null);
    if (ok) correct++;
    return {
      id: q.id,
      question: q.question,
      userAnswer: user,
      correctAnswer: correctOpt?.text ?? null,
      correct: ok,
      explanation: q.explanation || null,
      epigrafe: q.epigrafe || null,
      pagina: q.pagina || null
    };
  });

  const total = CACHE.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  const feedback = score >= 85 ? 'Excelente' : score >= 70 ? 'Bien' : 'Necesita repaso';

  res.json({ total, correct, score, feedback, breakdown });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 8100;
const host = '::';  // IPv6 obligatorio para AlwaysData

app.listen(port, host, () => {
  console.log(`✅ Quiz app listening on http://[::]:${port}`);
});
