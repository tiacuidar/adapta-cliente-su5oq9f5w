// LT-1-T07 — Limpeza das ocorrências criadas pelas provas reais da credencial Google (2026-10-05).
// Rodada 1 (v0.0.31, sem showDeleted): lapqac4852na9qq = "Consultoria | Unidade 2",
//   h6mx58dzrkgqqao = "Acompanhamento — Acuidar João Pessoa".
// Rodada 2 (v0.0.35, com showDeleted=true): lhh6qipldg199tz = "Acompanhamento — Acuidar João
//   Pessoa" CANCELADA (occurrence_type=cancelamento) — a 1ª rodada não enxergava o cancelamento.
// Todas importadas da agenda de TESTE do champion (source_system=google_calendar, IDs fixos
// conferidos contra as respostas da API). Fixtures de teste, não registros operacionais;
// mesmo critério das migrations 0005/0006/0009. Down vazio por design.

migrate(
  (app) => {
    for (const id of ['lapqac4852na9qq', 'h6mx58dzrkgqqao', 'lhh6qipldg199tz']) {
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
