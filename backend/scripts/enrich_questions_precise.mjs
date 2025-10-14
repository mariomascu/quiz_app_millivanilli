import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'preguntas.json');

function assignTituloByPage(pagina) {
    if (!pagina) return 'Sin clasificar';
    
    const pageNum = parseInt(pagina);
    
    // Rangos basados en las páginas del BOP
    if (pageNum >= 8921 && pageNum <= 8980) {
        return 'Título I';
    } else if (pageNum >= 8981 && pageNum <= 8998) {
        return 'Título II';
    } else if (pageNum >= 8998 && pageNum <= 9004) {
        return 'Título III';
    } else if (pageNum >= 9004 && pageNum <= 9008) {
        return 'Título IV';
    } else if (pageNum >= 9008 && pageNum <= 9010) {
        return 'Título V';
    } else if (pageNum >= 9010 && pageNum <= 9011) {
        return 'Disposiciones';
    } else {
        return 'Sin clasificar';
    }
}

function enrichQuestionsPrecise() {
    try {
        console.log('📖 Leyendo archivo de preguntas...');
        const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
        const questions = JSON.parse(rawData);
        
        console.log(`📊 Total de preguntas: ${questions.length}`);
        
        // Estadísticas antes del enriquecimiento
        const titulosCount = {};
        const paginasCount = {};
        
        console.log('\n🔍 Analizando páginas y asignando títulos...');
        
        questions.forEach((q, index) => {
            const titulo = assignTituloByPage(q.pagina);
            titulosCount[titulo] = (titulosCount[titulo] || 0) + 1;
            
            if (q.pagina) {
                paginasCount[q.pagina] = (paginasCount[q.pagina] || 0) + 1;
            }
            
            // Añadir campos tema y titulo
            q.tema = 'ROM Ayuntamiento de Córdoba 2025';
            q.titulo = titulo;
            
            if (index < 10) {
                console.log(`Pregunta ${q.id}: Página ${q.pagina} → "${q.titulo}"`);
            }
        });
        
        console.log('\n📈 Distribución por títulos:');
        Object.entries(titulosCount).forEach(([titulo, count]) => {
            console.log(`  ${titulo}: ${count} preguntas`);
        });
        
        console.log('\n📄 Distribución por páginas (primeras 20):');
        const sortedPages = Object.entries(paginasCount)
            .sort(([a], [b]) => parseInt(a) - parseInt(b))
            .slice(0, 20);
        sortedPages.forEach(([pagina, count]) => {
            const titulo = assignTituloByPage(pagina);
            console.log(`  Página ${pagina}: ${count} preguntas → ${titulo}`);
        });
        
        // Guardar archivo enriquecido
        const enrichedData = JSON.stringify(questions, null, 2);
        fs.writeFileSync(DATA_FILE, enrichedData);
        
        console.log('\n✅ Archivo enriquecido guardado exitosamente');
        console.log(`📁 Ubicación: ${DATA_FILE}`);
        
        return {
            total: questions.length,
            titulosCount,
            enriched: true
        };
        
    } catch (error) {
        console.error('❌ Error al enriquecer preguntas:', error.message);
        throw error;
    }
}

// Ejecutar enriquecimiento
try {
    const result = enrichQuestionsPrecise();
    console.log('\n🎉 Proceso completado');
    console.log('Resultado:', JSON.stringify(result, null, 2));
} catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
}
