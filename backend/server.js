import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, 'data', 'preguntas.json');

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

app.get('/api/questions', (_req, res) => {
  if (!CACHE) CACHE = loadQuestions();
  // barajar opciones *en cada request* sin modificar la caché original
  const randomized = CACHE.map(q => ({
    ...q,
    options: shuffle(q.options.slice())
  }));
  // Si no quieres exponer `is_correct` antes de corregir:
  const sanitized = randomized.map(q => ({
    ...q,
    options: q.options.map(o => ({ text: o.text })) // no enviamos is_correct al cliente
  }));
  res.json({ count: sanitized.length, questions: sanitized });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz app listening on :${PORT}`);
});
