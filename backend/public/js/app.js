'use strict';
// ========================================
// VARIABLES GLOBALES
// ========================================
let todasLasPreguntas = [];
let preguntasActuales = [];
let respuestasUsuario = {};
let cuestionarioCorregido = false;

// Referencias a elementos del DOM
const screens = {
    loading: document.getElementById('loadingScreen'),
    error: document.getElementById('errorScreen'),
    initial: document.getElementById('initialScreen'),
    quiz: document.getElementById('quizScreen'),
    results: document.getElementById('resultsScreen')
};

const elements = {
    errorMessage: document.getElementById('errorMessage'),
    generateBtn: document.getElementById('generateBtn'),
    correctBtn: document.getElementById('correctBtn'),
    repeatBtn: document.getElementById('repeatBtn'),
    newQuizBtn: document.getElementById('newQuizBtn'),
    questionsContainer: document.getElementById('questionsContainer'),
    resultsContainer: document.getElementById('resultsContainer'),
    correctedQuestionsContainer: document.getElementById('correctedQuestionsContainer')
};

// ========================================
// UTILIDADES DE SEGURIDAD Y ALEATORIEDAD
// ========================================
function escapeHTML(str = '') {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function mezclarArray(array) {
    const mezclado = Array.from(array);
    for (let i = mezclado.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mezclado[i], mezclado[j]] = [mezclado[j], mezclado[i]];
    }
    return mezclado;
}

// ========================================
document.addEventListener('DOMContentLoaded', () => {
    inicializarApp();
});

async function inicializarApp() {
    try {
        await cargarPreguntas();
        mostrarPantalla('initial');
        configurarEventListeners();
    } catch (error) {
        const msg = (error && error.message) ? error.message : 'No se pudo cargar el archivo de preguntas. Verifica que el archivo "preguntas.json" esté en la carpeta "data/".';
        mostrarError(msg);
        console.error('Error al inicializar la app:', error);
    }
}

// ========================================
// CARGA DE DATOS
// ========================================
async function cargarPreguntas() {
    try {
        const response = await fetch('./data/preguntas.json');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('El archivo JSON está vacío o no tiene el formato correcto');
        }

        // Transformar el formato del JSON (soportar el formato actual del fichero)
        // Formato esperado por la app (por pregunta):
        // { id: number, text: string, options: [{id: 'A', text: '...'}], correctAnswer: 'A', reference: string }
        todasLasPreguntas = data.map((q) => {
            const text = q.text || q.question || '';

            // Normalizar opciones (pueden venir como strings o como objetos).
            // Nuevo formato: cada opción puede incluir un booleano que indica si es la correcta (isCorrect/ is_correct/ correct).
            let options = [];
            if (Array.isArray(q.options) && q.options.length > 0) {
                if (typeof q.options[0] === 'string') {
                    // Si las opciones son strings, marcar como correctas comparando con q.answer si existe
                    options = q.options.map((optText) => ({ text: optText, isCorrect: q.answer ? (optText === q.answer) : false }));
                } else if (typeof q.options[0] === 'object') {
                    options = q.options.map((opt) => {
                        // Considerar la opción correcta solo si el indicador es estrictamente true.
                        // Aceptamos distintas claves: isCorrect, is_correct, correct
                        const isCorrect = (opt.isCorrect === true) || (opt.is_correct === true) || (opt.correct === true);
                        // Para compatibilidad con formatos antiguos: si no hay flag y q.answer existe, usar comparación exacta por texto
                        const fallbackIsCorrect = (!isCorrect && q.answer) ? (opt.text === q.answer || opt.label === q.answer) : false;
                        return { text: opt.text || opt.label || '', isCorrect: isCorrect || fallbackIsCorrect };
                    });
                }
            }

            // Normalizar campos adicionales: explanation, source, epigrafe, pagina
            const explanation = q.explanation || q.explain || q.reference || '';
            const source = q.source || q.referenceSource || '';
            const epigrafe = q.epigrafe || q.section || '';
            const pagina = q.pagina || q.page || q.p || null;

            return {
                id: q.id,
                text,
                // options: array de { text, isCorrect }
                options,
                // Almacenar texto de respuesta original (si existe) para fallback
                answerText: q.answer || q.correctAnswer || null,
                // no fijamos un id de respuesta aquí: lo calcularemos al renderizar tras barajar
                correctAnswer: null,
                reference: explanation || source || '',
                explanation,
                source,
                epigrafe,
                pagina
            };
        });

        // Validación mínima: IDs únicos y una correcta por pregunta
        const ids = new Set();
        for (const q of todasLasPreguntas) {
            if (ids.has(q.id)) {
                console.warn(`ID duplicado detectado en datos: ${q.id}`);
            }
            ids.add(q.id);
            const corrects = q.options.filter(o => o.isCorrect === true);
            if (corrects.length !== 1) {
                console.warn(`Pregunta id=${q.id} tiene ${corrects.length} opciones correctas`);
            }
        }

        console.log(`✅ ${todasLasPreguntas.length} preguntas cargadas y normalizadas correctamente`);

    } catch (error) {
        if (error instanceof TypeError || /Failed to fetch/i.test(error.message)) {
            throw new Error('Error al cargar preguntas: parece que estás abriendo el HTML con file://. Arranca un servidor HTTP local (ej. `python -m http.server` o `npx http-server`) y abre la app en http://localhost:8000');
        }
        throw new Error(`Error al cargar preguntas: ${error.message}`);
    }
}

// ========================================
// GESTIÓN DE PANTALLAS
// ========================================
function mostrarPantalla(nombrePantalla) {
    // Ocultar todas las pantallas
    Object.values(screens).forEach(screen => {
        screen.classList.add('hidden');
    });
    
    // Mostrar la pantalla solicitada
    if (screens[nombrePantalla]) {
        screens[nombrePantalla].classList.remove('hidden');
    }
}

function mostrarError(mensaje) {
    elements.errorMessage.textContent = mensaje;
    mostrarPantalla('error');
}

// ========================================
// EVENT LISTENERS
// ========================================
function configurarEventListeners() {
    elements.generateBtn.addEventListener('click', handleGenerarCuestionario);
    elements.correctBtn.addEventListener('click', corregirCuestionario);
    elements.repeatBtn.addEventListener('click', handleRepetirCuestionario);
    elements.newQuizBtn.addEventListener('click', handleNuevoCuestionario);
}

// ========================================
// HANDLERS DE EVENTOS
// ========================================
function handleGenerarCuestionario() {
    const cantidadSeleccionada = parseInt(document.querySelector('input[name="questionCount"]:checked').value);
    
    if (todasLasPreguntas.length < cantidadSeleccionada) {
        alert(`No hay suficientes preguntas en el banco. Se necesitan ${cantidadSeleccionada} pero solo hay ${todasLasPreguntas.length}.`);
        return;
    }
    
    generarCuestionario(cantidadSeleccionada);
    mostrarPantalla('quiz');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Al generar un nuevo cuestionario, asegurarnos de que el botón de corregir esté habilitado
    if (elements.correctBtn) elements.correctBtn.disabled = false;
    // y los botones de repetir/nuevo se deshabilitan hasta corregir
    if (elements.repeatBtn) elements.repeatBtn.disabled = true;
    if (elements.newQuizBtn) elements.newQuizBtn.disabled = true;
}

function handleRepetirCuestionario() {
    repetirCuestionario();
    mostrarPantalla('quiz');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleNuevoCuestionario() {
    nuevoCuestionario();
    mostrarPantalla('initial');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========================================
// FUNCIONES PRINCIPALES
// ========================================
function seleccionarPreguntasAleatorias(array, cantidad) {
    // Fisher–Yates para seleccionar sin sesgo
    const mezclado = mezclarArray(array);
    return mezclado.slice(0, cantidad);
}

function generarCuestionario(cantidad) {
    // Seleccionar preguntas aleatorias
    preguntasActuales = seleccionarPreguntasAleatorias(todasLasPreguntas, cantidad);
    
    // Resetear respuestas y estado
    respuestasUsuario = {};
    cuestionarioCorregido = false;
    
    // Renderizar cuestionario
    renderizarCuestionario();
}

function renderizarCuestionario() {
    elements.questionsContainer.innerHTML = '';
    
    preguntasActuales.forEach((pregunta, index) => {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'question-item';
        questionDiv.id = `question-${pregunta.id}`;
        
        // Barajar las opciones para que el orden cambie cada vez
        const opcionesBarajadas = mezclarArray(pregunta.options || []);
        // Asignar ids A,B,C... y determinar cuál es la respuesta correcta en este orden actual
        const opcionesConId = opcionesBarajadas.map((opt, idx) => ({ id: String.fromCharCode(65 + idx), text: opt.text, isCorrect: !!opt.isCorrect }));
        const opcionesOrdenadas = opcionesConId; // variable usada abajo

        // Guardar las opciones actuales (con id) en la propia pregunta para referencias posteriores
        pregunta.options = opcionesConId.map(o => ({ id: o.id, text: o.text, isCorrect: o.isCorrect }));

        // Guardar el id actual de la respuesta correcta en la propia pregunta
        const correctOpts = opcionesConId.filter(o => o.isCorrect);
        if (correctOpts.length === 1) {
            pregunta.correctAnswer = correctOpts[0].id;
        } else if (correctOpts.length > 1) {
            // Si hay más de una opción marcada como correcta en el JSON, considerar el dato inválido
            // y no marcar ninguna como correcta para evitar falsos positivos.
            pregunta.correctAnswer = null;
            console.warn(`Pregunta id=${pregunta.id} tiene más de una opción con isCorrect=true. Ignorando marcas para evitar ambigüedad.`);
        } else {
            // Fallback: si en la carga quedó answerText, buscar una coincidencia exacta en las opciones actuales
            if (pregunta.answerText) {
                const matchByText = opcionesConId.filter(o => o.text === pregunta.answerText);
                if (matchByText.length === 1) {
                    pregunta.correctAnswer = matchByText[0].id;
                } else {
                    pregunta.correctAnswer = null;
                }
            } else {
                pregunta.correctAnswer = null;
            }
        }
    
        questionDiv.innerHTML = `
            <div class="question-number">Pregunta ${index + 1}</div>
            <div class="question-text">${escapeHTML(pregunta.text)}</div>
        
            <div class="options-container">
                ${opcionesOrdenadas.map(opcion => `
                    <div class="answer-option" data-option="${opcion.id}">
                        <input 
                            type="radio" 
                            id="q${pregunta.id}_${opcion.id}" 
                            name="question${pregunta.id}" 
                            value="${opcion.id}"
                            ${cuestionarioCorregido ? 'disabled' : ''}
                        >
                        <label for="q${pregunta.id}_${opcion.id}">${opcion.id}. ${escapeHTML(opcion.text)}</label>
                    </div>
                `).join('')}
            </div>
        `;
        
        elements.questionsContainer.appendChild(questionDiv);
    });
    
    // Añadir event listeners a los radio buttons del contenedor del cuestionario
    if (elements.questionsContainer) {
        elements.questionsContainer.querySelectorAll('input[type="radio"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const questionId = parseInt(e.target.name.replace('question', ''));
                respuestasUsuario[questionId] = e.target.value;
            });
        });
    }
}

function corregirCuestionario() {
    cuestionarioCorregido = true;
    let correctas = 0;
    let incorrectas = 0;
    let sinResponder = 0;
    
    // Limpiar contenedor de preguntas corregidas
    elements.correctedQuestionsContainer.innerHTML = '<h3>📝 Revisión de Respuestas</h3>';
    
    preguntasActuales.forEach((pregunta) => {
        const questionDiv = document.getElementById(`question-${pregunta.id}`);
        const respuestaUsuario = respuestasUsuario[pregunta.id];

        // Recalcular la opción correcta en el momento de corregir para garantizar consistencia
        if (Array.isArray(pregunta.options)) {
            const correctsNow = pregunta.options.filter(o => o.isCorrect === true);
            if (correctsNow.length === 1) {
                pregunta.correctAnswer = correctsNow[0].id;
            } else if (correctsNow.length > 1) {
                // Inconsistencia en los datos: más de una opción marcada
                console.warn(`Pregunta id=${pregunta.id} tiene varias opciones con isCorrect=true. Ignorando marcas.`);
                pregunta.correctAnswer = null;
            } else {
                // No hay isCorrect explícito: intentar fallback por answerText si existe
                if (pregunta.answerText) {
                    const matchByTextNow = pregunta.options.filter(o => o.text === pregunta.answerText);
                    if (matchByTextNow.length === 1) {
                        pregunta.correctAnswer = matchByTextNow[0].id;
                    } else {
                        pregunta.correctAnswer = null;
                    }
                } else {
                    pregunta.correctAnswer = null;
                }
            }
        }

        // Limpiar cualquier feedback previo en esta pregunta (evitar duplicados)
        const existingFeedback = questionDiv.querySelectorAll('.feedback');
        existingFeedback.forEach(f => f.remove());

        // Limpiar clases de estado previas en las opciones
        const opcionesElems = questionDiv.querySelectorAll('.answer-option');
        opcionesElems.forEach(optEl => {
            optEl.classList.remove('user-answer', 'correct-answer');
            const input = optEl.querySelector('input[type="radio"]');
            if (input) input.disabled = false; // restaurar estado temporalmente
        });

        // Si el usuario respondió, asegurarnos de que su selección quede marcada en el DOM
        if (respuestaUsuario) {
            const userInput = questionDiv.querySelector(`#q${pregunta.id}_${respuestaUsuario}`);
            if (userInput) {
                userInput.checked = true;
                const parent = userInput.closest('.answer-option');
                if (parent) {
                    // Si la selección coincide con la respuesta correcta, marcar como correcta (verde)
                    if (pregunta.correctAnswer && respuestaUsuario === pregunta.correctAnswer) {
                        parent.classList.add('correct-answer');
                    } else {
                        // Si no, marcar la opción del usuario como su respuesta (rojo/usuario)
                        parent.classList.add('user-answer');
                    }
                }
            }
        }

        let feedbackDiv;
        if (!respuestaUsuario) {
            // Sin responder
            sinResponder++;
            const opcionCorrecta = pregunta.options.find(opt => opt.id === pregunta.correctAnswer) || { text: '' };
            feedbackDiv = document.createElement('div');
            feedbackDiv.className = 'feedback unanswered';
            let fbHtml = `La respuesta correcta es: <strong>${pregunta.correctAnswer}. ${escapeHTML(opcionCorrecta.text)}</strong>`;
            if (pregunta.explanation) fbHtml += `<div class="explanation">📝 Explicación: ${escapeHTML(pregunta.explanation)}</div>`;
            if (pregunta.source) fbHtml += `<div class="source">📚 Fuente: ${escapeHTML(pregunta.source)}</div>`;
            if (pregunta.epigrafe) fbHtml += `<div class="epigrafe">🗂 Epígrafe: ${escapeHTML(pregunta.epigrafe)}</div>`;
            if (pregunta.pagina) fbHtml += `<div class="pagina">📄 Página: ${escapeHTML(String(pregunta.pagina))}</div>`;
            feedbackDiv.innerHTML = fbHtml;
            questionDiv.appendChild(feedbackDiv);
        } else if (respuestaUsuario === pregunta.correctAnswer) {
            // Correcta
            correctas++;
            questionDiv.classList.add('correct');

            feedbackDiv = document.createElement('div');
            feedbackDiv.className = 'feedback correct';
            feedbackDiv.textContent = '✅ ¡Correcto!';
            questionDiv.appendChild(feedbackDiv);
        } else {
            // Incorrecta
            incorrectas++;
            questionDiv.classList.add('incorrect');

            // Marcar respuesta del usuario y marcar sólo la opción correcta (si existe)
            if (pregunta.correctAnswer) {
                const target = questionDiv.querySelector(`.answer-option[data-option="${pregunta.correctAnswer}"]`);
                if (target) target.classList.add('correct-answer');
            }

            // Añadir feedback detallado
            const opcionCorrecta = pregunta.options.find(opt => opt.id === pregunta.correctAnswer) || { text: '' };
            feedbackDiv = document.createElement('div');
            feedbackDiv.className = 'feedback incorrect';
            let fbHtml = `❌ Incorrecto. La respuesta correcta es: <strong>${pregunta.correctAnswer}. ${escapeHTML(opcionCorrecta.text)}</strong>`;
            if (pregunta.explanation) fbHtml += `<div class="explanation">📝 Explicación: ${escapeHTML(pregunta.explanation)}</div>`;
            if (pregunta.source) fbHtml += `<div class="source">📚 Fuente: ${escapeHTML(pregunta.source)}</div>`;
            if (pregunta.epigrafe) fbHtml += `<div class="epigrafe">🗂 Epígrafe: ${escapeHTML(pregunta.epigrafe)}</div>`;
            if (pregunta.pagina) fbHtml += `<div class="pagina">📄 Página: ${escapeHTML(String(pregunta.pagina))}</div>`;
            feedbackDiv.innerHTML = fbHtml;
            questionDiv.appendChild(feedbackDiv);
        }

        // Clonar la pregunta al panel de revisión
        const clonedQuestion = questionDiv.cloneNode(true);
        clonedQuestion.id = `corrected-${pregunta.id}`;
        if (respuestaUsuario) {
            const clonedInput = clonedQuestion.querySelector(`#q${pregunta.id}_${respuestaUsuario}`);
            if (clonedInput) {
                clonedInput.checked = true;
                clonedInput.disabled = true;
            }
        }
        if (pregunta.correctAnswer) {
            const correctInClone = clonedQuestion.querySelector(`.answer-option[data-option="${pregunta.correctAnswer}"]`);
            if (correctInClone) correctInClone.classList.add('correct-answer');
        }
        elements.correctedQuestionsContainer.appendChild(clonedQuestion);
    });
    
    // Deshabilitar solo los radio buttons del cuestionario (no los del selector inicial)
    if (elements.questionsContainer) {
        elements.questionsContainer.querySelectorAll('input[type="radio"]').forEach(input => {
            input.disabled = true;
        });
    }
    
    // Calcular puntuación
    const puntuacion = calcularPuntuacion(correctas, incorrectas);
    mostrarResultados(correctas, incorrectas, sinResponder, puntuacion);
    // Deshabilitar el botón de corregir una vez corregido
    if (elements.correctBtn) elements.correctBtn.disabled = true;
    // Habilitar y mostrar los botones de repetir y nuevo cuestionario
    if (elements.repeatBtn) {
        elements.repeatBtn.disabled = false;
        elements.repeatBtn.style.display = '';
    }
    if (elements.newQuizBtn) {
        elements.newQuizBtn.disabled = false;
        elements.newQuizBtn.style.display = '';
    }

    // Mostrar la pantalla de resultados
    mostrarPantalla('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function calcularPuntuacion(correctas, incorrectas) {
    const puntos = correctas - (incorrectas * 0.33);
    const total = preguntasActuales.length;
    const porcentaje = (correctas / total) * 100;
    const notaSobre10 = (puntos / total) * 10;
    
    return {
        puntos: puntos.toFixed(2),
        total: total,
        porcentaje: porcentaje.toFixed(2),
        notaSobre10: Math.max(0, notaSobre10).toFixed(2)
    };
}

function mostrarResultados(correctas, incorrectas, sinResponder, puntuacion) {
    // Reconstruir cálculo para mostrar los pasos
    const total = puntuacion.total;
    const puntosNetos = parseFloat(puntuacion.puntos);
    const puntosBrutos = correctas; // +1 por correcta
    const deduccionPorIncorrectas = parseFloat((incorrectas * 0.33).toFixed(2));
    const porcentaje = parseFloat(puntuacion.porcentaje);
    const notaSobre10 = parseFloat(puntuacion.notaSobre10);

    elements.resultsContainer.innerHTML = `
        <h2>📊 Resultados del Test</h2>
        <div class="result-item">✅ Preguntas acertadas: <strong>${correctas}</strong></div>
        <div class="result-item">❌ Preguntas falladas: <strong>${incorrectas}</strong></div>
        <div class="result-item">⚪ Preguntas sin responder: <strong>${sinResponder}</strong></div>
        <div class="final-score">${puntuacion.puntos} / ${puntuacion.total}</div>
        <div class="result-item">📈 Porcentaje de acierto: <strong>${puntuacion.porcentaje}%</strong></div>
        <div class="result-item">📝 Nota sobre 10: <strong>${puntuacion.notaSobre10}</strong></div>

        <div class="calculation">
            <h3>📐 Cálculo de la puntuación</h3>
            <div class="calc-row">Puntos por aciertos: <strong>${puntosBrutos} × 1 = ${puntosBrutos.toFixed(2)}</strong></div>
            <div class="calc-row">Deducción por errores: <strong>${incorrectas} × 0.33 = -${deduccionPorIncorrectas.toFixed(2)}</strong></div>
            <div class="calc-row">Puntos netos: <strong>${puntosBrutos.toFixed(2)} - ${deduccionPorIncorrectas.toFixed(2)} = ${puntosNetos.toFixed(2)}</strong></div>
            <div class="calc-row">Porcentaje de acierto: <strong>(${correctas} / ${total}) × 100 = ${porcentaje.toFixed(2)}%</strong></div>
            <div class="calc-row">Nota sobre 10: <strong>(${puntosNetos.toFixed(2)} / ${total}) × 10 = ${puntuacion.notaSobre10}</strong></div>
        </div>
    `;
}

function repetirCuestionario() {
    // Mezclar el orden de las preguntas actuales
    preguntasActuales = mezclarArray(preguntasActuales);
    // Resetear respuestas y estado
    respuestasUsuario = {};
    cuestionarioCorregido = false;

    // Renderizar cuestionario
    renderizarCuestionario();
    // Al repetir, habilitar el botón de corregir y deshabilitar repetir/nuevo hasta corregir
    if (elements.correctBtn) elements.correctBtn.disabled = false;
    if (elements.repeatBtn) elements.repeatBtn.disabled = true;
    if (elements.newQuizBtn) elements.newQuizBtn.disabled = true;
    // Mostrar pantalla de cuestionario
    mostrarPantalla('quiz');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function nuevoCuestionario() {
    // Resetear todo
    preguntasActuales = [];
    respuestasUsuario = {};
    cuestionarioCorregido = false;
    // Limpiar contenedores
    elements.questionsContainer.innerHTML = '';
    elements.resultsContainer.innerHTML = '';
    elements.correctedQuestionsContainer.innerHTML = '';
    // Al volver a la pantalla inicial, asegurar estado de botones
    if (elements.correctBtn) elements.correctBtn.disabled = false;
    if (elements.repeatBtn) elements.repeatBtn.disabled = true;
    if (elements.newQuizBtn) elements.newQuizBtn.disabled = true;
    // Mostrar pantalla inicial para que el usuario seleccione tipo de test
    mostrarPantalla('initial');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========================================
// UTILIDADES
// ========================================
console.log('✅ Aplicación de Cuestionarios inicializada correctamente');
