import fs from 'fs';
import path from 'path';

const DATA_PATH = process.argv[2] || path.join(process.cwd(), 'data', 'preguntas.json');

function normalizeText(s = '') {
  return String(s || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function backupFile(filePath) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const backup = path.join(dir, `${base}.bak.${ts}`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function ensureOptionObject(opt) {
  if (typeof opt === 'string') return { text: opt };
  if (opt && typeof opt === 'object') return { ...opt };
  return { text: '' };
}

function findMatchByAnswer(options, answerText) {
  if (!answerText) return null;
  const normAnswer = normalizeText(answerText);
  for (const opt of options) {
    const t = opt.text || opt.label || '';
    if (normalizeText(t) === normAnswer) return opt;
  }
  return null;
}

function fixQuestions(arr) {
  const report = {
    total: arr.length,
    fixed: 0,
    warnings: 0,
    details: []
  };

  const out = arr.map((q) => {
    const qcopy = { ...q };

    // Normalizar texto principal
    if (!qcopy.text && qcopy.question) qcopy.text = qcopy.question;

    // Normalizar options
    let opts = Array.isArray(qcopy.options) ? qcopy.options.map(ensureOptionObject) : [];

    // Forzar campos mínimos
    opts = opts.map(o => ({ text: o.text || o.label || '', is_correct: !!(o.is_correct === true || o.isCorrect === true || o.correct === true) }));

    // Intentos de reconciliación
    const marked = opts.filter(o => o.is_correct === true);

    let changed = false;
    const detail = { id: qcopy.id, actions: [] };

    if (qcopy.answer) {
      const match = findMatchByAnswer(opts, qcopy.answer);
      if (match) {
        // Marcar solo esta como correcta
        opts = opts.map(o => ({ ...o, is_correct: normalizeText(o.text) === normalizeText(match.text) }));
        changed = true;
        detail.actions.push('marked-by-answer');
      } else if (marked.length === 1) {
        // Hay una marcada pero no coincide textualmente con answer: mantener marca y avisar
        detail.actions.push('keep-marked-not-match-answer');
      } else if (marked.length > 1) {
        // Múltiples marcadas y no hay match; quitar marcas para revisar manualmente
        opts = opts.map(o => ({ ...o, is_correct: false }));
        changed = true;
        detail.actions.push('cleared-multiple-marks-no-match');
      } else {
        // no match y ninguna marcada: nada que hacer
        detail.actions.push('no-match-no-mark');
      }
    } else {
      // No hay answer explícito
      if (marked.length === 1) {
        detail.actions.push('single-mark-kept');
      } else if (marked.length > 1) {
        // múltiples marcadas: limpiar para revisión
        opts = opts.map(o => ({ ...o, is_correct: false }));
        changed = true;
        detail.actions.push('cleared-multiple-marks-no-answer');
      } else {
        detail.actions.push('no-answer-no-mark');
      }
    }

    qcopy.options = opts;

    if (changed) report.fixed++;

    // Si todavía no hay exactamente una marcada, emitimos warning
    const afterMarked = qcopy.options.filter(o => o.is_correct === true);
    if (afterMarked.length !== 1) {
      report.warnings++;
      detail.warning = `afterMarked=${afterMarked.length}`;
    }

    report.details.push(detail);
    return qcopy;
  });

  return { out, report };
}

(async function main(){
  try {
    if (!fs.existsSync(DATA_PATH)) {
      console.error('No se encontró el archivo:', DATA_PATH);
      process.exit(2);
    }

    console.log('Leyendo', DATA_PATH);
    const backup = backupFile(DATA_PATH);
    console.log('Backup creado en', backup);

    const arr = readJson(DATA_PATH);
    if (!Array.isArray(arr)) {
      console.error('El JSON raíz no es un array. Abortando.');
      process.exit(3);
    }

    const { out, report } = fixQuestions(arr);

    const outPath = DATA_PATH; // sobrescribir el original (ya tenemos backup)
    writeJson(outPath, out);

    console.log('\n--- Informe resumen ---');
    console.log('Total preguntas:', report.total);
    console.log('Preguntas modificadas automáticamente:', report.fixed);
    console.log('Preguntas con advertencias (requieren revisión manual):', report.warnings);
    console.log('Detalles (primeros 20):');
    console.log(JSON.stringify(report.details.slice(0,20), null, 2));

    console.log('\nLista completa de IDs con advertencia:');
    const warnIds = report.details.filter(d => d.warning).map(d => d.id);
    console.log(warnIds.join(', ') || '(ninguna)');

    process.exit(0);
  } catch (err) {
    console.error('Error durante la reparación:', err);
    process.exit(1);
  }
})();
