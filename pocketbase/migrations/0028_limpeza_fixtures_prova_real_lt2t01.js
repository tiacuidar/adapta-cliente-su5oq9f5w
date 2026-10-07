// LT-2-T01 — limpeza das fixtures da PROVA REAL da escrita (acuidar + donahelp)
// Padrão AP-2026-10-06-1258: parâmetro app; limpeza revalidada por contagem real.
// Migrations aplicadas não reexecutam (AP-2026-10-06-1710) — migration NOVA para cada rodada.
migrate(
  (app) => {
    const registros = app.findRecordsByFilter(
      'ocorrencias',
      "titulo = 'LT-2-T01 prova de escrita'",
      '-created',
      50,
      0,
    )
    let removidos = 0
    for (const r of registros) {
      app.delete(r)
      removidos++
    }
    console.log('0028 limpeza fixtures prova real LT-2-T01: removidos ' + removidos)
  },
  (app) => {
    // Down: não recria fixture de prova
  },
)
