// LT-1-T05 (complemento) — Fixture remanescente da regressão (R6 transicao), criada após a 0005 rodar.
// Mesmo critério da 0005: fixture de teste identificada por ID fixo; down vazio por design.

migrate(
  (app) => {
    try {
      const rec = app.findRecordById('ocorrencias', 'nibdw6wkoihlntr')
      app.delete(rec)
    } catch (err) {
      // já excluída — idempotente
    }
  },
  (app) => {
    // Down: não recria fixture de teste
  },
)
