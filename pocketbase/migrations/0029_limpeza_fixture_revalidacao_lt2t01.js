// LT-2-T01 — limpeza da fixture de REVALIDAÇÃO do fechamento (título "LT-2-T01 revalidacao")
// Padrão AP-2026-10-06-1258: parâmetro app; limpeza revalidada por contagem real.
// Migrations aplicadas não reexecutam (AP-2026-10-06-1710) — migration NOVA para cada rodada.
migrate(
  (app) => {
    const registros = app.findRecordsByFilter(
      'ocorrencias',
      "titulo = 'LT-2-T01 revalidacao'",
      '-created',
      50,
      0,
    )
    let removidos = 0
    for (const r of registros) {
      app.delete(r)
      removidos++
    }
    console.log('0029 limpeza fixture revalidacao LT-2-T01: removidos ' + removidos)
  },
  (app) => {
    // Down: não recria fixture de prova
  },
)
