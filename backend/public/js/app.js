'use strict';
// ========================================
// VARIABLES GLOBALES
// ========================================
let todasLasPreguntas = [];
let preguntasActuales = [];
let respuestasUsuario = {};
let cuestionarioCorregido = false;
let selectedTheme = null; // objeto { id, title }
let selectedTitle = null; // objeto { id, title }
// Preguntas marcadas para repasar (ids)
let reviewSet = new Set();
// Lista ordenada de números de pregunta (1-based) para mostrar en el panel
let reviewList = [];

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

// Añadir nuevas pantallas del flujo de selección
screens.themes = document.getElementById('themesScreen');
screens.themeConfirm = document.getElementById('themeConfirmScreen');
screens.count = document.getElementById('countScreen');

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

// Elemento subtítulo bajo el h2 (se mostrará el nombre del tema seleccionado)
const subtitleEl = document.querySelector('p.subtitle');

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
        // mostrar pantalla de selección de temario
        await loadAndRenderThemes();
        mostrarPantalla('themes');
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
    reviewList = [];
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
    // Cerrar y re-renderizar panel de repaso
    closeReviewPanel();
    renderReviewPanel();
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
                pagina,
                // conservar campo de relación con el título/tema para filtrado posterior
                titulo_id: q.titulo_id ?? q.tituloId ?? q.titulo ?? null
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
            if (screen && screen.classList) screen.classList.add('hidden');
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
    // Controlar subtítulo: en la pantalla de temas debe estar vacío
    if (subtitleEl) {
        if (nombrePantalla === 'themes') subtitleEl.textContent = '';
        // si vamos a la pantalla de selección de título, mostrar el tema si está seleccionado
        if (nombrePantalla === 'themeConfirm' && selectedTheme) subtitleEl.textContent = String(selectedTheme.title || '');
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
    elements.correctBtn.addEventListener('click', () => {
        confirmBeforeCorrection();
    });
    elements.repeatBtn.addEventListener('click', handleRepetirCuestionario);
    elements.newQuizBtn.addEventListener('click', handleNuevoCuestionario);
    // nuevo botón: volver al menú principal (recargar la app y volver al inicio)
    const backToMenuBtn = document.getElementById('backToMenuBtn');
    if (backToMenuBtn) backToMenuBtn.addEventListener('click', () => { window.location.reload(); });

    // Nuevos listeners para navegación entre pantallas
    const themeBackBtn = document.getElementById('themeBackBtn');
    const toCountBtn = document.getElementById('toCountBtn');
    const countBackBtn = document.getElementById('countBackBtn');
    if (themeBackBtn) themeBackBtn.addEventListener('click', () => { mostrarPantalla('themes'); });
    // toCountBtn removed: navigation happens automatically when selecting a title
    if (countBackBtn) countBackBtn.addEventListener('click', () => { mostrarPantalla('themeConfirm'); });
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

    // Comprobar que el pool filtrado tiene suficientes preguntas
    const pool = getFilteredPool();
    if (!Array.isArray(pool) || pool.length === 0) {
        alert('No se encontraron preguntas para la selección actual (tema/título). Vuelve atrás y selecciona otro título o tema.');
        return;
    }
    if (pool.length < cantidadSeleccionada) {
        alert(`No hay suficientes preguntas en la selección filtrada. Se necesitan ${cantidadSeleccionada} pero solo hay ${pool.length}. Reduce el número o elige otro título.`);
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
    // Volver a la pantalla 2 (selección de título) para elegir otro título dentro del mismo tema
    // No borramos la selección del tema para facilitar seleccionar otro título del mismo tema
    // limpiar preguntas y resultados visibles
    preguntasActuales = [];
    respuestasUsuario = {};
    cuestionarioCorregido = false;
    elements.questionsContainer.innerHTML = '';
    elements.resultsContainer.innerHTML = '';
    elements.correctedQuestionsContainer.innerHTML = '';
    // Mostrar la pantalla de selección de títulos
    mostrarPantalla('themeConfirm');
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
    const pool = getFilteredPool();
    console.log('DEBUG generarCuestionario pool length after filtering:', pool.length);
    // Seleccionar preguntas aleatorias
    preguntasActuales = seleccionarPreguntasAleatorias(pool, cantidad);
    
    // Resetear respuestas y estado
    respuestasUsuario = {};
    cuestionarioCorregido = false;
    // Limpiar cualquier marca de repaso previa
    clearReviewState();
    
    // Renderizar cuestionario
    renderizarCuestionario();
}

// Devuelve el pool de preguntas filtrado según selectedTitle/selectedTheme
function getFilteredPool() {
    let pool = Array.isArray(todasLasPreguntas) ? todasLasPreguntas.slice() : [];
    if (selectedTitle) {
        const key = String(selectedTitle.id);
        const titleText = String(selectedTitle.title || '');
        pool = pool.filter(q => {
            const qTid = q.titulo_id !== undefined && q.titulo_id !== null ? String(q.titulo_id) : null;
            const qText = String(q.epigrafe ?? q.titulo ?? '');
            return (qTid && qTid === key) || (qText && qText === titleText);
        });
        return pool;
    }

    if (selectedTheme) {
        const key = String(selectedTheme.id);
        const themeText = String(selectedTheme.title || '');
        pool = pool.filter(q => {
            const qTid = q.titulo_id !== undefined && q.titulo_id !== null ? String(q.titulo_id) : null;
            const qText = String(q.epigrafe ?? q.titulo ?? '');
            return (qTid && qTid === key) || (qText && qText === themeText);
        });
    }
    return pool;
}

// Cargar temas desde el endpoint y renderizar botones
async function loadAndRenderThemes() {
    try {
        const res = await fetch('/api/temas');
        if (!res.ok) throw new Error('No se pudieron cargar los temas');
        const payload = await res.json();
        const temas = payload?.temas || [];
        console.log('DEBUG /api/temas payload:', payload);
        renderThemes(temas);
    } catch (err) {
        console.error('Error cargando temas:', err);
        // Si ya cargamos preguntas con éxito, construir temas cliente-side como fallback
        if (Array.isArray(todasLasPreguntas) && todasLasPreguntas.length > 0) {
            console.warn('Fallback: construyendo lista de temas a partir de preguntas cargadas en cliente');
            const group = {};
            todasLasPreguntas.forEach(q => {
                const key = q.titulo_id ?? (q.epigrafe ? String(q.epigrafe).trim() : 'Sin tema');
                group[key] = (group[key] || 0) + 1;
            });
            const temas = Object.keys(group).map(k => ({ id: k, title: String(k), count: group[k] }));
            renderThemes(temas);
            mostrarPantalla('themes');
            return;
        }

        // Fallback por defecto: mostrar mensaje amigable en la pantalla de temas para reintentar
        const container = document.getElementById('themesContainer');
        if (container) {
            container.innerHTML = `<div class="error-box">No se pudieron cargar los temarios. Comprueba la conexión con la base de datos y pulsa <button id="retryThemes" class="btn btn-primary">Reintentar</button></div>`;
            const retry = document.getElementById('retryThemes');
            if (retry) retry.addEventListener('click', () => loadAndRenderThemes());
        }
        mostrarPantalla('themes');
    }
}

function renderThemes(temas) {
    const container = document.getElementById('themesContainer');
    if (!container) return;
    container.innerHTML = '';
    console.log('DEBUG renderThemes received temas:', temas);
    temas.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'theme-button';
        btn.type = 'button';
    // Mostrar únicamente el nombre del tema (sin recuento). Si falta title, usar id como fallback
    const display = (t && (t.title || t.nombre || t.name)) ? (t.title || t.nombre || t.name) : String(t && t.id ? t.id : 'Tema');
    btn.textContent = display;
    // NO exponer id en el DOM; solo mostrar el título (texto)
        btn.addEventListener('click', async () => {
            // Guardar selección y cargar títulos del tema
            // Usar como título el texto mostrado (display) como fallback si t.title es falsy
            selectedTheme = { id: t.id, title: (t.title || display) };
            // Actualizar subtítulo inmediatamente con el texto mostrado
            if (subtitleEl) subtitleEl.textContent = String(selectedTheme.title || '');
            await fetchTitlesForTheme(t.id);
        });
        container.appendChild(btn);
    });
    // Asegurar que la pantalla de temas está visible
    mostrarPantalla('themes');
}

async function fetchTitlesForTheme(temaId) {
    try {
        const res = await fetch(`/api/titulos?temaId=${encodeURIComponent(String(temaId))}`);
        if (!res.ok) throw new Error('No se pudieron cargar los títulos');
        const payload = await res.json();
        const titulos = payload?.titulos || [];
        renderTitles(titulos);
        mostrarPantalla('themeConfirm');
    } catch (err) {
        console.error('Error cargando títulos:', err);
        // Fallback: intentar construir títulos desde preguntas locales si existen
        if (Array.isArray(todasLasPreguntas) && todasLasPreguntas.length > 0) {
            const map = {};
            todasLasPreguntas.forEach(q => {
                const key = q.titulo_id ?? (q.epigrafe ? String(q.epigrafe).trim() : 'Sin título');
                map[key] = true;
            });
            const built = Object.keys(map).map(k => ({ id: k, title: String(k) }));
            renderTitles(built);
            mostrarPantalla('themeConfirm');
            return;
        }
        const container = document.getElementById('titlesContainer');
        if (container) container.innerHTML = `<div class="error-box">No se pudieron cargar los títulos. <button id="retryTitles" class="btn btn-primary">Reintentar</button></div>`;
        const retry = document.getElementById('retryTitles');
        if (retry) retry.addEventListener('click', () => fetchTitlesForTheme(temaId));
        mostrarPantalla('themeConfirm');
    }
}

function renderTitles(titulos) {
    const container = document.getElementById('titlesContainer');
    if (!container) return;
    container.innerHTML = '';
    titulos.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'theme-button';
        btn.type = 'button';
        // truncar texto largo con CSS; aquí ponemos el texto
        btn.textContent = t.title;
        btn.dataset.tid = String(t.id);
        btn.setAttribute('aria-label', `Título ${t.title}`);
        btn.addEventListener('click', () => {
            selectedTitle = { id: t.id, title: t.title };
            // ir automáticamente a la pantalla de conteo
            const titleEl = document.getElementById('countScreenTitle');
            if (selectedTitle && titleEl) titleEl.textContent = `Selecciona el número de preguntas para el test: (${selectedTitle.title})`;
            mostrarPantalla('count');
        });
        container.appendChild(btn);
    });
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
                // Determinar número de pregunta (1-based) dentro del cuestionario actual
                const qElements = Array.from(elements.questionsContainer.querySelectorAll('.question-item'));
                const qnum = qElements.findIndex(q => q.id === `question-${qid}`) + 1;
                if (!isActive) {
                    reviewSet.add(qid);
                    // Añadir al final de reviewList si no existe
                    if (!reviewList.includes(qnum)) reviewList.push(qnum);
                    e.currentTarget.classList.add('active');
                    e.currentTarget.setAttribute('aria-pressed', 'true');
                    if (container) container.classList.add('marked-review');
                } else {
                    reviewSet.delete(qid);
                    // Quitar de la lista ordenada
                    reviewList = reviewList.filter(n => n !== qnum);
                    e.currentTarget.classList.remove('active');
                    e.currentTarget.setAttribute('aria-pressed', 'false');
                    if (container) container.classList.remove('marked-review');
                }
                persistReviewState();
                updateReviewBadge();
                renderReviewPanel();
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
    // Cargar lista ordenada si existe
    try {
        const rawList = localStorage.getItem('reviewList');
        if (rawList) reviewList = JSON.parse(rawList).map(Number);
    } catch (e) { reviewList = []; }

    // Asegurar que el contenido y estado del badge reflejen reviewSet
    const countEl = reviewBadge.querySelector('.review-badge-count');
    if (countEl) countEl.textContent = reviewSet.size;
    updateReviewBadge();

    // Crear panel de repaso (si no existe) y asociar toggle al badge
    let panel = document.getElementById('reviewPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'reviewPanel';
        panel.className = 'review-panel';
        // contenido será construido por renderReviewPanel()
        document.body.appendChild(panel);
    }
    // Click en badge: toggle panel
    reviewBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReviewPanel();
    });
    // Cerrar panel si se hace click fuera
    document.addEventListener('click', (ev) => {
        const p = document.getElementById('reviewPanel');
        const b = document.getElementById('reviewBadge');
        if (!p || !p.classList.contains('open')) return;
        if (ev.target.closest('#reviewPanel') || ev.target.closest('#reviewBadge')) return;
        closeReviewPanel();
    });
    renderReviewPanel();
}

function persistReviewState() {
    try {
        const arr = Array.from(reviewSet.values());
        localStorage.setItem('reviewSet', JSON.stringify(arr));
        // Guardar la lista ordenada de números de pregunta
        localStorage.setItem('reviewList', JSON.stringify(reviewList));
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

// Antes de corregir, confirmar con el usuario según el estado del cuestionario
function confirmBeforeCorrection() {
    // Contar preguntas sin responder
    const total = preguntasActuales.length;
    let sinResponder = 0;
    preguntasActuales.forEach(p => {
        if (!respuestasUsuario[p.id]) sinResponder++;
    });

    // Número de preguntas marcadas para repasar
    const repasarCount = reviewSet.size;

    // Construir mensaje y lógica de confirmación según casos
    (async () => {
        if (sinResponder > 0 && repasarCount > 0) {
            const msg = `Hay ${sinResponder} pregunta(s) sin responder y ${repassarText(repasarCount)} marcadas para repasar. ¿Deseas corregir el examen igualmente?`;
            const ok = await showConfirmModal(msg, 'Confirmar corrección');
            if (ok) corregirCuestionario();
            return;
        }

        if (sinResponder > 0) {
            const msg = `Hay ${sinResponder} pregunta(s) sin responder. ¿Deseas continuar y corregir el examen?`;
            const ok = await showConfirmModal(msg, 'Preguntas sin responder');
            if (ok) corregirCuestionario();
            return;
        }

        if (repasarCount > 0) {
            const msg = `Hay ${repassarText(repasarCount)} marcadas para repasar. ¿Deseas corregir el examen igualmente?`;
            const ok = await showConfirmModal(msg, 'Preguntas marcadas para repasar');
            if (ok) corregirCuestionario();
            return;
        }

        // Si no hay sin responder y no hay marcadas, advertir antes de corregir
        const allAnsweredMsg = 'Parece que has respondido todas las preguntas. ¿Estás seguro de que quieres proceder a corregir el examen?';
        const ok = await showConfirmModal(allAnsweredMsg, 'Confirmar corrección');
        if (ok) corregirCuestionario();
    })();
}

function repassarText(count) {
    return count === 1 ? '1 pregunta' : `${count} preguntas`;
}

// Modal de confirmación personalizado (Promise-based)
function showConfirmModal(message, title = 'Confirmar') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const titleEl = document.getElementById('confirmTitle');
        const okBtn = document.getElementById('confirmOk');
        const cancelBtn = document.getElementById('confirmCancel');
        const overlay = modal.querySelector('.modal-overlay');

        if (!modal || !msgEl || !okBtn || !cancelBtn) {
            // Fallback al confirm nativo si algo falta
            const res = window.confirm(message);
            resolve(res);
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;

        // Mostrar modal
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');

        // Guardar foco
        const lastFocused = document.activeElement;

        function cleanup(result) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeydown);
            if (lastFocused) lastFocused.focus();
            resolve(result);
        }

        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onKeydown(e) {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onOk();
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeydown);

        // Enfocar el botón principal para accesibilidad
        okBtn.focus();
    });
}

/* ==========================
   PANEL DE REPASO (lista desplegable)
   ========================== */
function renderReviewPanel() {
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;
    // Construir lista en columna con números ordenados
    if (!reviewList || reviewList.length === 0) {
        panel.innerHTML = '<div class="review-empty">No hay preguntas marcadas para repasar</div>';
        panel.classList.remove('has-items');
        return;
    }
    panel.classList.add('has-items');
    const itemsHtml = reviewList.map(n => `<button class="review-item" data-qnum="${n}">Pregunta ${n}</button>`).join('');
    panel.innerHTML = `<div class="review-list">${itemsHtml}</div>`;

    // Añadir listeners para saltar a la pregunta
    panel.querySelectorAll('.review-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qnum = parseInt(btn.dataset.qnum, 10);
            // Encontrar la pregunta por orden en el DOM y hacer scroll
            const qElements = Array.from(elements.questionsContainer.querySelectorAll('.question-item'));
            const target = qElements[qnum - 1];
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // cerrar panel
                closeReviewPanel();
                // aportar un foco visible al elemento para facilitar localización
                target.classList.add('flash-target');
                setTimeout(() => target.classList.remove('flash-target'), 900);
            }
        });
    });
}

function toggleReviewPanel() {
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) closeReviewPanel(); else openReviewPanel();
}

function openReviewPanel() {
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;
    renderReviewPanel();
    panel.classList.add('open');
}

function closeReviewPanel() {
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;
    panel.classList.remove('open');
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
    // Mantener selectedTheme pero limpiar selectedTitle: se volverá a la pantalla de títulos
    selectedTitle = null;
    // Limpiar contenedores
    elements.questionsContainer.innerHTML = '';
    elements.resultsContainer.innerHTML = '';
    elements.correctedQuestionsContainer.innerHTML = '';
    // Al volver a la pantalla inicial, asegurar estado de botones
    if (elements.correctBtn) elements.correctBtn.disabled = false;
    if (elements.repeatBtn) elements.repeatBtn.disabled = true;
    if (elements.newQuizBtn) elements.newQuizBtn.disabled = true;
    // Mostrar pantalla de selección de títulos (segunda pantalla) si hay tema seleccionado
    if (selectedTheme) {
        // volver a cargar los títulos para el tema seleccionado
        fetchTitlesForTheme(selectedTheme.id);
        mostrarPantalla('themeConfirm');
    } else {
        mostrarPantalla('themes');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ========================================
// UTILIDADES
// ========================================
console.log('✅ Aplicación de Cuestionarios inicializada correctamente');
