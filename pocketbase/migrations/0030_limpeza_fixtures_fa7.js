// FA-7 — limpeza das fixtures da prova do mapa (ocorrência "FA-7 fixture programada"
// + unidades_info da unidade 253 com 3 tentativas)
// Padrão AP-2026-10-06-1258: parâmetro app; limpeza revalidada por contagem real.
// Migrations aplicadas não reexecutam (AP-2026-10-06-1710) — migration NOVA para cada rodada.
migrate(
  (app) => {
    let removidos = 0
    const ocs = app.findRecordsByFilter(
      'ocorrencias',
      "titulo = 'FA-7 fixture programada'",
      '-created',
      50,
      0,
    )
    for (const r of ocs) {
      app.delete(r)
      removidos++
    }
    let infos = 0
    try {
      const uis = app.findRecordsByFilter(
        'unidades_info',
        "observacao = 'FA-7 fixture nao_retorna'",
        '-created',
        50,
        0,
      )
      for (const r of uis) {
        app.delete(r)
        infos++
      }
    } catch (err) {
      // collection pode não ter registros
    }
    console.log('0030 limpeza fixtures FA-7: ocs=' + removidos + ' unidades_info=' + infos)
  },
  (app) => {
    // Down: não recria fixture de prova
  },
)
