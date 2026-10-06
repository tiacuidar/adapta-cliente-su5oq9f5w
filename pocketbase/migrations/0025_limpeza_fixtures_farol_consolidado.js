// FAROL-1 (farol consolidado) — limpeza das fixtures das provas do semáforo
// Remove as avaliações criadas pelas provas (marcadores: "fixture de prova farol consolidado"
// e "diag nativo"). Padrão AP-2026-10-06-1258: parâmetro app no up; limpeza revalidada por
// contagem real após aplicar.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    const registros = app.findRecordsByFilter('avaliacoes', 'id != ""', '-updated', 500, 0)
    let removidos = 0
    for (const r of registros) {
      const obs = r.getString('observacao') || ''
      if (
        obs.indexOf('fixture de prova farol consolidado') !== -1 ||
        obs.indexOf('diag nativo') !== -1
      ) {
        app.delete(r)
        removidos++
      }
    }
    console.log('0025 limpeza farol consolidado: removidos ' + removidos)
  },
  (app) => {
    // Down: não recria fixtures de prova
  },
)
