import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'preguntas.json');

function assignTituloByPage(pagina) {
    if (!pagina) return 'Sin clasificar';
    
    const pageNum = parseInt(pagina);
    
    // Si la página es menor a 100, asumimos que es página del PDF (1-91)
    // Si es mayor a 1000, asumimos que es página del BOP (8921-9011)
    let isPDFPage = pageNum < 100;
    
    if (isPDFPage) {
        // Convertir páginas del PDF a rangos de títulos
        if (pageNum >= 1 && pageNum <= 60) {
            return 'Título I';
        } else if (pageNum >= 61 && pageNum <= 78) {
            return 'Título II';
        } else if (pageNum >= 78 && pageNum <= 84) {
            return 'Título III';
        } else if (pageNum >= 84 && pageNum <= 88) {
            return 'Título IV';
        } else if (pageNum >= 88 && pageNum <= 90) {
            return 'Título V';
        } else if (pageNum >= 90 && pageNum <= 91) {
            return 'Disposiciones';
        } else {
            return 'Sin clasificar';
        }
    } else {
        // Usar rangos del BOP (8921-9011)
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
}

function enrichQuestionsFinal() {
    try {
        console.log('📖 Leyendo archivo de preguntas...');
        const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
        const questions = JSON.parse(rawData);
        
        console.log(`📊 Total de preguntas: ${questions.length}`);
        
        // Estadísticas antes del enriquecimiento
        const titulosCount = {};
        const paginasCount = {};
        const pdfPages = [];
        const bopPages = [];
        
        console.log('\n🔍 Analizando páginas y asignando títulos...');
        
        questions.forEach((q, index) => {
            const titulo = assignTituloByPage(q.pagina);
            titulosCount[titulo] = (titulosCount[titulo] || 0) + 1;
            
            if (q.pagina) {
                paginasCount[q.pagina] = (paginasCount[q.pagina] || 0) + 1;
                
                // Clasificar tipo de página
                const pageNum = parseInt(q.pagina);
                if (pageNum < 100) {
                    pdfPages.push(pageNum);
                } else if (pageNum > 1000) {
                    bopPages.push(pageNum);
                }
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
        
        console.log('\n📄 Análisis de tipos de páginas:');
        console.log(`  Páginas PDF (1-91): ${pdfPages.length} preguntas`);
        console.log(`  Páginas BOP (8921-9011): ${bopPages.length} preguntas`);
        
        if (pdfPages.length > 0) {
            console.log(`  Rango páginas PDF: ${Math.min(...pdfPages)} - ${Math.max(...pdfPages)}`);
        }
        if (bopPages.length > 0) {
            console.log(`  Rango páginas BOP: ${Math.min(...bopPages)} - ${Math.max(...bopPages)}`);
        }
        
        // Guardar archivo enriquecido
        const enrichedData = JSON.stringify(questions, null, 2);
        fs.writeFileSync(DATA_FILE, enrichedData);
        
        console.log('\n✅ Archivo enriquecido guardado exitosamente');
        console.log(`📁 Ubicación: ${DATA_FILE}`);
        
        return {
            total: questions.length,
            titulosCount,
            pdfPages: pdfPages.length,
            bopPages: bopPages.length,
            enriched: true
        };
        
    } catch (error) {
        console.error('❌ Error al enriquecer preguntas:', error.message);
        throw error;
    }
}

// Ejecutar enriquecimiento
try {
    const result = enrichQuestionsFinal();
    console.log('\n🎉 Proceso completado');
    console.log('Resultado:', JSON.stringify(result, null, 2));
} catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
}
