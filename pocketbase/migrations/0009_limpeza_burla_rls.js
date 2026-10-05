// LT-1-T06 — Limpeza da fixture "Burla RLS" (doescaies8ygd73), criada durante a prova P4
// ANTES do fix da validação de empresa no hook criar. Fixture de teste; down vazio por design.

migrate(
  (app) => {
    try {
      const rec = app.findRecordById('ocorrencias', 'doescaies8ygd73')
      app.delete(rec)
    } catch (err) {
      // já excluída — idempotente
    }
    // 2026-10-05 — Prova real LT-1-T07: 2 ocorrências importadas da agenda de TESTE do
    // champion (source_system=google_calendar, IDs fixos conferidos). Fixtures de teste,
    // não registros operacionais; limpeza no mesmo padrão 0005/0006.
    for (const id of ['lapqac4852na9qq', 'h6mx58dzrkgqqao']) {
      try {
        const recTeste = app.findRecordById('ocorrencias', id)
        app.delete(recTeste)
      } catch (err) {
        // já excluída — idempotente
      }
    }
  },
  (app) => {
    // Down: não recria fixture de teste
  },
)
