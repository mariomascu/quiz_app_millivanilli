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
// Config desde .env (cargar explícitamente el .env junto a este fichero)
dotenv.config({ path: path.join(__dirname, '.env') });
const USE_DB = process.env.USE_DB === 'true';
let dbPool = null;

async function initDb() {
  if (!USE_DB) return;
  if (dbPool) return;
  // Permitir seleccionar entre distintas configuraciones mediante DB_ENV
  // Valores esperados: 'production' (por defecto) o 'local'
  const dbEnv = (process.env.DB_ENV || 'production').trim();

  // helper: quitar comillas accidentales en valores del .env
  const strip = (v) => {
    if (typeof v !== 'string') return v;
    return v.replace(/^\s*"\s*|\s*"\s*$/g, '').replace(/^\s*'\s*|\s*'\s*$/g, '');
  };

  let dbHost, dbPort, dbUser, dbPass, dbName;
  if (dbEnv === 'local') {
    dbHost = strip(process.env.LOCAL_DB_HOST || process.env.DB_HOST || '127.0.0.1');
    dbPort = process.env.LOCAL_DB_PORT ? parseInt(strip(process.env.LOCAL_DB_PORT), 10) : (process.env.DB_PORT ? parseInt(strip(process.env.DB_PORT), 10) : 3306);
    dbUser = strip(process.env.LOCAL_DB_USER || process.env.DB_USER || 'root');
    dbPass = strip(process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '');
    dbName = strip(process.env.LOCAL_DB_NAME || process.env.DB_NAME || '');
  } else {
    // production/default: usar variables DB_* (ej. conexión AlwaysData)
    dbHost = strip(process.env.DB_HOST || 'localhost');
    dbPort = process.env.DB_PORT ? parseInt(strip(process.env.DB_PORT), 10) : 3306;
    dbUser = strip(process.env.DB_USER || 'root');
    dbPass = strip(process.env.DB_PASSWORD || '');
    dbName = strip(process.env.DB_NAME || '');
  }

  console.log(`Init DB (env=${dbEnv}) connecting to ${dbHost}:${dbPort} database='${dbName}' user='${dbUser ? dbUser : 'N/A'}'`);

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
  const sanitized = randomized.map(q => ({ ...q, options: q.options.map(o => ({ id: o.id, text: o.text, is_correct: !!o.is_correct })) }));
      return res.json({ count: sanitized.length, questions: sanitized });
    }

    if (!CACHE) CACHE = loadQuestions();
  const randomized = CACHE.map(q => ({ ...q, options: shuffle(q.options.slice()) }));
  const sanitized = randomized.map(q => ({ ...q, options: q.options.map(o => ({ id: o.id ?? null, text: o.text ?? o.label ?? o.texto ?? '', is_correct: !!(o.is_correct || o.isCorrect || o.es_correcta || o.correct) })) }));
  return res.json({ count: sanitized.length, questions: sanitized });
  } catch (err) {
    console.error('Error cargando preguntas:', err);
    return res.status(500).json({ error: 'Error al cargar preguntas' });
  }
});

// Endpoint para listar temas (temarios) disponibles
app.get('/api/temas', async (_req, res) => {
  try {
    console.log('/api/temas called');
    let rows = [];
    if (USE_DB) {
      if (!dbPool) await initDb();
      // Intentar leer tabla de temas/títulos si existe
      try {
        // Preferir tabla 'temas' con columnas id/name/title
        const [temasRows] = await dbPool.query("SHOW TABLES LIKE 'temas'");
        if (temasRows && temasRows.length > 0) {
          const [rowsTemas] = await dbPool.query('SELECT * FROM temas');
          // mapear posible nombre entre las columnas disponibles
          const temasMapped = rowsTemas.map(r => ({ id: r.id, title: r.nombre || r.title || r.name || r.nombre_tema || String(r.id), count: 0 }));
          return res.json({ count: temasMapped.length, temas: temasMapped });
        }
      } catch (e) {
        // ignorar y continuar con fallback
        console.warn('Error comprobando tabla temas:', e.message);
      }

      try {
        // Si existe tabla 'titulos' (nombres de títulos), devolverlos
        const [titTables] = await dbPool.query("SHOW TABLES LIKE 'titulos'");
        if (titTables && titTables.length > 0) {
          const [titRows] = await dbPool.query('SELECT * FROM titulos');
          const mapped = titRows.map(r => ({ id: r.id, title: r.nombre || r.title || r.name || r.titulo || String(r.id), count: 0 }));
          return res.json({ count: mapped.length, temas: mapped });
        }
      } catch (e) {
        console.warn('Error comprobando tabla titulos:', e.message);
      }

      // Fallback: leer preguntas y agrupar por titulo_id/epigrafe
      const [preguntasRows] = await dbPool.query('SELECT id, titulo_id, texto, epigrafe FROM preguntas');
      rows = preguntasRows.map(r => ({ id: r.id, titulo_id: r.titulo_id, epigrafe: r.epigrafe }));
    } else {
      if (!CACHE) CACHE = loadQuestions();
      rows = CACHE.map(q => ({ id: q.id, titulo_id: q.titulo_id ?? null, epigrafe: q.epigrafe ?? null }));
    }

    // Agrupar por titulo_id o por epigrafe como fallback
    const group = {};
    rows.forEach(r => {
      const key = r.titulo_id ?? (r.epigrafe ? String(r.epigrafe).trim() : 'Sin tema');
      group[key] = (group[key] || 0) + 1;
    });

    // Construir array de temas. Si titulo_id es numérico, devolverlo como id; si es texto usar como id también
    const temas = Object.keys(group).map(k => ({ id: k, title: String(k), count: group[k] }));
    return res.json({ count: temas.length, temas });
  } catch (err) {
    console.error('Error cargando temas:', err);
    return res.status(500).json({ error: 'Error al cargar temas' });
  }
});

// Endpoint para listar los títulos asociados a un tema (si existe tabla 'titulos' o por preguntas)
app.get('/api/titulos', async (req, res) => {
  const temaId = req.query.temaId;
  try {
    if (USE_DB) {
      if (!dbPool) await initDb();
      // Si existe tabla 'titulos' y tiene relación con tema, intentar leer
      try {
        const [tables] = await dbPool.query("SHOW TABLES LIKE 'titulos'");
        if (tables && tables.length > 0) {
          // Intentar buscar por tema_id si se pasó
          if (temaId) {
            const [rows] = await dbPool.query('SELECT * FROM titulos WHERE tema_id = ?', [temaId]);
            if (rows && rows.length > 0) return res.json({ count: rows.length, titulos: rows.map(r => ({ id: r.id, title: r.nombre || r.title || r.name || r.titulo || String(r.id) })) });
          }
          // Fallback: devolver todos los titulos
          const [all] = await dbPool.query('SELECT * FROM titulos');
          return res.json({ count: all.length, titulos: all.map(r => ({ id: r.id, title: r.nombre || r.title || r.name || r.titulo || String(r.id) })) });
        }
      } catch (e) {
        console.warn('Error comprobando tabla titulos:', e.message);
      }

      // Si no hay tabla titulos, intentar obtener titulos únicos desde preguntas por titulo_id
      const [preguntasRows] = await dbPool.query('SELECT DISTINCT titulo_id, epigrafe FROM preguntas');
      const temas = preguntasRows.map(r => ({ id: r.titulo_id ?? r.epigrafe ?? String(r.titulo_id), title: String(r.titulo_id || r.epigrafe) }));
      return res.json({ count: temas.length, titulos: temas });
    }

    // Fallback cuando no hay DB: agrupar desde CACHE
    if (!CACHE) CACHE = loadQuestions();
    const map = {};
    CACHE.forEach(q => {
      const key = q.titulo_id ?? q.epigrafe ?? 'Sin título';
      map[key] = true;
    });
    const titulos = Object.keys(map).map(k => ({ id: k, title: String(k) }));
    return res.json({ count: titulos.length, titulos });
  } catch (err) {
    console.error('Error cargando titulos:', err);
    return res.status(500).json({ error: 'Error al cargar titulos' });
  }
});

// Health check: verifica conexión a la DB (si está habilitada)
app.get('/api/health', async (_req, res) => {
  try {
    if (USE_DB) {
      await initDb();
      // prueba simple
      const [rows] = await dbPool.query('SELECT 1 as ok');
      if (Array.isArray(rows)) return res.json({ db: 'ok' });
      return res.status(500).json({ db: 'unexpected result', rows });
    }
    return res.json({ db: 'disabled', message: 'USE_DB=false' });
  } catch (err) {
    console.error('Health check DB error:', err);
    return res.status(500).json({ db: 'error', message: err.message });
  }
});

app.post('/api/submit', async (req, res) => {
  try {
    const answers = req.body?.answers || {}; // { "id": "texto opción elegida" }
    let questionsSource = null;

    if (USE_DB) {
      // Cargar desde DB
      questionsSource = await loadQuestionsFromDb();
    } else {
      if (!CACHE) CACHE = loadQuestions();
      questionsSource = CACHE;
    }

    let correct = 0;
    const breakdown = questionsSource.map(q => {
      const user = answers[String(q.id)] ?? null;
      // q.options puede ser array de { id, text, is_correct } o formato antiguo
      const correctOpt = Array.isArray(q.options) ? q.options.find(o => o.is_correct || o.es_correcta || false) : null;

      const correctText = correctOpt ? (correctOpt.text ?? correctOpt.texto ?? null) : null;
      const ok = user === correctText;
      if (ok) correct++;

      return {
        id: q.id,
        question: q.text || q.question || null,
        userAnswer: user,
        correctAnswer: correctText,
        correct: ok,
        explanation: q.explanation || q.explicacion || null,
        epigrafe: q.epigrafe || null,
        pagina: q.pagina || q.pagina_pdf || q.pagina_bop || null
      };
    });

    const total = questionsSource.length;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const feedback = score >= 85 ? 'Excelente' : score >= 70 ? 'Bien' : 'Necesita repaso';

    return res.json({ total, correct, score, feedback, breakdown });
  } catch (err) {
    console.error('Error procesando submit:', err);
    return res.status(500).json({ error: 'Error al procesar respuestas' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 8100;
const host = '::';  // IPv6 obligatorio para AlwaysData

app.listen(port, host, () => {
  console.log(`✅ Quiz app listening on http://[::]:${port}`);
});
