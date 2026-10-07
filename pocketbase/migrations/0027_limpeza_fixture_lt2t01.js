// LT-2-T01 — limpeza da fixture da prova de escrita (ocorrência "LT-2-T01 prova de escrita")
// Padrão AP-2026-10-06-1258: parâmetro app no up; limpeza revalidada por contagem real.
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
    console.log('0027 limpeza fixture LT-2-T01: removidos ' + removidos)
  },
  (app) => {
    // Down: não recria fixture de prova
  },
)
