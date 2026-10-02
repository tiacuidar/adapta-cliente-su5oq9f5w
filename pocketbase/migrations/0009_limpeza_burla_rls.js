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
  },
  (app) => {
    // Down: não recria fixture de teste
  },
)
