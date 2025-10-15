'use strict';
// ========================================
// VARIABLES GLOBALES
// ========================================
let todasLasPreguntas = [];
let preguntasActuales = [];
let respuestasUsuario = {};
let cuestionarioCorregido = false;
// Preguntas marcadas para repasar (ids)
let reviewSet = new Set();

// Badge DOM
let reviewBadge = null;

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
        configurarModalPuntuacion();
        initReviewState();
        // Al iniciar la aplicación (o recargar), resetear el estado de repaso
        // para que el contador empiece en 0 y no muestre el badge en la página principal
        clearReviewState();
    } catch (error) {
        const msg = (error && error.message) ? error.message : 'No se pudo cargar el archivo de preguntas. Verifica que el archivo "preguntas.json" esté en la carpeta "data/".';
        mostrarError(msg);
        console.error('Error al inicializar la app:', error);
    }
}

// Limpia el estado de repaso completamente (memoria, DOM y badge)
function clearReviewState() {
    reviewSet = new Set();
    persistReviewState();
    updateReviewBadge();

    // Quitar clases active de los botones y aria-pressed
    document.querySelectorAll('.review-flag.active').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });

    // Quitar clase visual de las preguntas marcadas
    document.querySelectorAll('.question-item.marked-review').forEach(q => q.classList.remove('marked-review'));
    // Asegurar que el badge muestre 0 y esté oculto
    const existingBadge = document.getElementById('reviewBadge');
    if (existingBadge) {
        const cnt = existingBadge.querySelector('.review-badge-count');
        if (cnt) cnt.textContent = '0';
        existingBadge.classList.remove('visible');
    }
}

// ========================================
// CARGA DE DATOS
// ========================================
async function cargarPreguntas() {
    try {
        // Preferimos pedir las preguntas al endpoint del servidor. Esto evita problemas
        // cuando `data/` no está dentro de `public/` (el servidor ya ofrece `/api/questions`).
        const response = await fetch('/api/questions');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const payload = await response.json();

        // El endpoint puede devolver { count, questions } o directamente un array.
        const data = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.questions) ? payload.questions : []);

        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('El endpoint /api/questions devolvió un resultado vacío o con formato inesperado');
        }

        // Transformar el formato del JSON/DB (soportar el formato actual del fichero y el de la BD)
        // Formato esperado por la app (por pregunta):
        // { id: number, text: string, options: [{ text: '...' }], answerText: '...' , explanation, source, epigrafe, pagina }
        todasLasPreguntas = data.map((q) => {
            // Texto de la pregunta: puede venir como text, question o texto (BD)
            const text = q.text || q.question || q.texto || '';

            // Normalizar opciones (pueden venir como strings o como objetos).
            // Aceptamos distintos nombres en las opciones: text / texto, is_correct / es_correcta / isCorrect
            let options = [];
            if (Array.isArray(q.options) && q.options.length > 0) {
                if (typeof q.options[0] === 'string') {
                    // Si las opciones son strings, marcar como correctas comparando con q.answer o q.respuesta_correcta si existe
                    const answerText = q.answer || q.respuesta_correcta || q.answerText || null;
                    options = q.options.map((optText) => ({ text: optText, isCorrect: answerText ? (optText === answerText) : false }));
                } else if (typeof q.options[0] === 'object') {
                    options = q.options.map((opt) => {
                        const optText = opt.text || opt.texto || opt.label || '';
                        // Marcas de correcto posibles
                        const isCorrect = (opt.isCorrect === true) || (opt.is_correct === true) || (opt.correct === true) || (opt.es_correcta === true);
                        // Fallback: si no hay flag y q.answer/ respuesta_correcta existe, comparar por texto
                        const fallbackAnswer = q.answer || q.respuesta_correcta || q.answerText || null;
                        const fallbackIsCorrect = (!isCorrect && fallbackAnswer) ? (optText === fallbackAnswer) : false;
                        return { text: optText, isCorrect: isCorrect || fallbackIsCorrect };
                    });
                }
            }

            // Normalizar campos adicionales: explanation, source, epigrafe, pagina
            const explanation = q.explanation || q.explicacion || q.explain || q.reference || '';
            const source = q.source || q.referenceSource || '';
            const epigrafe = q.epigrafe || q.section || '';
            // posibles páginas en SQL: pagina_pdf, pagina_bop
            const pagina = q.pagina || q.page || q.p || q.pagina_pdf || q.pagina_bop || null;

            return {
                id: q.id,
                text,
                // options: array de { text, isCorrect }
                options,
                // Almacenar texto de respuesta original (si existe) para fallback
                answerText: q.answer || q.respuesta_correcta || q.correctAnswer || null,
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
    // Si estamos en la pantalla inicial, ocultar el badge flotante de repasar
    const badge = document.getElementById('reviewBadge');
    if (badge) {
        if (nombrePantalla === 'initial') badge.classList.remove('visible');
        else if (reviewSet.size > 0) badge.classList.add('visible');
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

// Event listeners para el modal de puntuación
function configurarModalPuntuacion() {
    const openBtn = document.getElementById('openScoringBtn');
    const closeBtn = document.getElementById('closeScoringBtn');
    const modal = document.getElementById('scoringModal');
    const overlay = modal ? modal.querySelector('.modal-overlay') : null;
    let lastFocused = null;

    if (!modal || !openBtn) return;

    function openModal() {
        lastFocused = document.activeElement;
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        // mover foco al primer elemento interactivo dentro del modal
        const close = modal.querySelector('.modal-close');
        if (close) close.focus();
        document.addEventListener('keydown', handleKeydown);
    }

    function closeModal() {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        if (lastFocused) lastFocused.focus();
        document.removeEventListener('keydown', handleKeydown);
    }

    function handleKeydown(e) {
        if (e.key === 'Escape') closeModal();
        // TODO: trap focus inside modal (simple implementation left for future)
    }

    openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', closeModal);
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
    // Limpiar cualquier marca de repaso previa
    clearReviewState();
    
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
    
        // Construir HTML del enunciado y opciones
        questionDiv.innerHTML = `
            <div class="review-toggle">
                <span class="review-label">Repasar</span>
                <button class="review-flag material-symbols-outlined ${reviewSet.has(String(pregunta.id)) ? 'active' : ''}" data-qid="${pregunta.id}" title="Marcar para repasar" aria-pressed="${reviewSet.has(String(pregunta.id)) ? 'true' : 'false'}">flag</button>
            </div>
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

        // Aplicar clase si está marcada para repasar
        if (reviewSet.has(String(pregunta.id))) {
            questionDiv.classList.add('marked-review');
        }
        
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
        // Añadir listeners a los botones de bandera de repaso
        elements.questionsContainer.querySelectorAll('.review-flag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const qid = String(e.currentTarget.dataset.qid);
                const container = document.getElementById(`question-${qid}`);
                const isActive = reviewSet.has(qid);
                if (!isActive) {
                    reviewSet.add(qid);
                    e.currentTarget.classList.add('active');
                    e.currentTarget.setAttribute('aria-pressed', 'true');
                    if (container) container.classList.add('marked-review');
                } else {
                    reviewSet.delete(qid);
                    e.currentTarget.classList.remove('active');
                    e.currentTarget.setAttribute('aria-pressed', 'false');
                    if (container) container.classList.remove('marked-review');
                }
                persistReviewState();
                updateReviewBadge();
            });
        });

        // Hacer que la zona entre la etiqueta y la bandera sea clicable: delegar clicks del contenedor
        elements.questionsContainer.querySelectorAll('.review-toggle').forEach(container => {
            container.addEventListener('click', (e) => {
                // Si el clic proviene ya del botón, no reinventemos la rueda
                const clickedFlag = e.target.closest('.review-flag');
                if (clickedFlag) return; // el handler del botón gestionará el toggle

                // Si hacen click en cualquier parte del contenedor (etiqueta), encontrar el botón y disparar click
                const btn = container.querySelector('.review-flag');
                if (btn) btn.click();
            });
        });
    }
}

function initReviewState() {
    try {
        const raw = localStorage.getItem('reviewSet');
        if (raw) {
            const arr = JSON.parse(raw);
            reviewSet = new Set(arr.map(String));
        }
    } catch (err) {
        reviewSet = new Set();
    }

    // Reutilizar badge existente si ya hay uno (evita duplicados si initReviewState se llama varias veces)
    const existing = document.getElementById('reviewBadge');
    if (existing) {
        reviewBadge = existing;
    } else {
        // Crear badge flotante
        reviewBadge = document.createElement('div');
        reviewBadge.className = 'review-badge';
        reviewBadge.id = 'reviewBadge';
        // Contenido interno: label + contador
        reviewBadge.innerHTML = `<span class="review-badge-label">Repasar</span><span class="review-badge-count">0</span>`;
        document.body.appendChild(reviewBadge);
    }
    // Asegurar que el contenido y estado del badge reflejen reviewSet
    const countEl = reviewBadge.querySelector('.review-badge-count');
    if (countEl) countEl.textContent = reviewSet.size;
    updateReviewBadge();
}

function persistReviewState() {
    try {
        const arr = Array.from(reviewSet.values());
        localStorage.setItem('reviewSet', JSON.stringify(arr));
    } catch (err) {
        console.error('No se pudo guardar reviewSet en localStorage', err);
    }
}

function updateReviewBadge() {
    if (!reviewBadge) return;
    const count = reviewSet.size;
    const countEl = reviewBadge.querySelector('.review-badge-count');
    if (countEl) countEl.textContent = count;
    if (count > 0) reviewBadge.classList.add('visible'); else reviewBadge.classList.remove('visible');
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
    
    // Deshabilitar todos los radio buttons de las preguntas (evitar que el usuario cambie respuestas)
    const disableRadiosIn = (root) => {
        if (!root) return;
        root.querySelectorAll('input[type="radio"]').forEach(input => {
            input.disabled = true;
            // quitar del tab order para mayor accesibilidad post-corrección
            try { input.setAttribute('tabindex', '-1'); } catch (e) {}
        });
    };

    disableRadiosIn(elements.questionsContainer);
    disableRadiosIn(elements.correctedQuestionsContainer);
    
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

    // Limpiar marcas de repaso cuando se corrige el cuestionario
    clearReviewState();
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

    // Limpiar marcas de repaso al repetir
    clearReviewState();

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
    // Limpiar marcas de repaso al iniciar nuevo cuestionario
    clearReviewState();
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
