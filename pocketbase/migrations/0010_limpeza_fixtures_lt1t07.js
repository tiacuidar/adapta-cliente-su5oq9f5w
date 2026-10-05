// LT-1-T07 — Limpeza das 2 ocorrências criadas pela prova real da credencial Google (2026-10-05).
// Importadas da agenda de TESTE do champion (source_system=google_calendar, IDs fixos conferidos
// contra a resposta da API: lapqac4852na9qq = "Consultoria | Unidade 2", h6mx58dzrkgqqao =
// "Acompanhamento — Acuidar João Pessoa"). Fixtures de teste, não registros operacionais;
// mesmo critério das migrations 0005/0006/0009. Down vazio por design.

migrate(
  (app) => {
    for (const id of ['lapqac4852na9qq', 'h6mx58dzrkgqqao']) {
      try {
        const rec = app.findRecordById('ocorrencias', id)
        app.delete(rec)
      } catch (err) {
        // já excluída — idempotente
      }
    }
  },
  (app) => {
    // Down: não recria fixture de teste
  },
)
