// FA-8 — limpeza das fixtures da prova da agenda (títulos "FA-8 fixture feita" e
// "FA-8 fixture agendada")
// Padrão AP-2026-10-06-1258: parâmetro app; limpeza revalidada por contagem real.
// Migrations aplicadas não reexecutam (AP-2026-10-06-1710) — migration NOVA para cada rodada.
migrate(
  (app) => {
    const registros = app.findRecordsByFilter(
      'ocorrencias',
      "titulo ~ 'FA-8 fixture'",
      '-created',
      50,
      0,
    )
    let removidos = 0
    for (const r of registros) {
      app.delete(r)
      removidos++
    }
    console.log('0032 limpeza fixtures FA-8: removidos ' + removidos)
  },
  (app) => {
    // Down: não recria fixture de prova
  },
)
