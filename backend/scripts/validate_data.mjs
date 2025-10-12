import fs from 'fs';
const file = process.argv[2] || './data/preguntas.json';
const arr = JSON.parse(fs.readFileSync(file,'utf8'));
let ok = true;
for (const q of arr) {
  const c = q.options.filter(o => o.is_correct === true);
  if (c.length !== 1 || q.answer !== c[0].text) {
    console.error(`❌ Pregunta ${q.id}: incorrecta (correctas=${c.length})`);
    ok = false;
  }
}
console.log(ok ? '✔ Datos correctos' : '⚠ Revisa las preguntas marcadas');
process.exit(ok ? 0 : 1);
