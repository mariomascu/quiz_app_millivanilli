import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'preguntas.json');

function extractTituloFromEpigrafe(epigrafe) {
    if (!epigrafe) return 'Sin clasificar';
    
    // Patrones para identificar títulos
    const patterns = [
        { pattern: /Título\s+I[^I]/i, titulo: 'Título I' },
        { pattern: /Título\s+II[^I]/i, titulo: 'Título II' },
        { pattern: /Título\s+III[^I]/i, titulo: 'Título III' },
        { pattern: /Título\s+IV[^I]/i, titulo: 'Título IV' },
        { pattern: /Título\s+V[^I]/i, titulo: 'Título V' },
        { pattern: /Disposiciones?\s+(Finales?|Adicionales?|Transitorias?)/i, titulo: 'Disposiciones' }
    ];
    
    for (const { pattern, titulo } of patterns) {
        if (pattern.test(epigrafe)) {
            return titulo;
        }
    }
    
    // Si no coincide con ningún patrón, intentar extraer del texto
    if (epigrafe.includes('Título I')) return 'Título I';
    if (epigrafe.includes('Título II')) return 'Título II';
    if (epigrafe.includes('Título III')) return 'Título III';
    if (epigrafe.includes('Título IV')) return 'Título IV';
    if (epigrafe.includes('Título V')) return 'Título V';
    if (epigrafe.includes('Disposiciones')) return 'Disposiciones';
    
    return 'Sin clasificar';
}

function enrichQuestions() {
    try {
        console.log('📖 Leyendo archivo de preguntas...');
        const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
        const questions = JSON.parse(rawData);
        
        console.log(`📊 Total de preguntas: ${questions.length}`);
        
        // Estadísticas antes del enriquecimiento
        const titulosCount = {};
        
        console.log('\n🔍 Analizando epígrafes existentes...');
        questions.forEach((q, index) => {
            const titulo = extractTituloFromEpigrafe(q.epigrafe);
            titulosCount[titulo] = (titulosCount[titulo] || 0) + 1;
            
            // Añadir campos tema y titulo
            q.tema = 'ROM Ayuntamiento de Córdoba 2025';
            q.titulo = titulo;
            
            if (index < 5) {
                console.log(`Pregunta ${q.id}: "${q.titulo}" (epígrafe: ${q.epigrafe || 'N/A'})`);
            }
        });
        
        console.log('\n📈 Distribución por títulos:');
        Object.entries(titulosCount).forEach(([titulo, count]) => {
            console.log(`  ${titulo}: ${count} preguntas`);
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
    const result = enrichQuestions();
    console.log('\n🎉 Proceso completado');
    console.log('Resultado:', JSON.stringify(result, null, 2));
} catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
}
