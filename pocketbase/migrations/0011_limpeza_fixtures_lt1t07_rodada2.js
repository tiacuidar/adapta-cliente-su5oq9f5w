// LT-1-T07 — Limpeza das ocorrências criadas pela 2ª prova real (v0.0.35, com showDeleted=true).
// A migration 0010 já havia rodado (aplicada em 2026-10-05T12:25Z com as IDs da 1ª prova) e
// migrations aplicadas não reexecutam — esta 0011 remove as 3 fixtures remanescentes, criadas
// pelas provas com a agenda de TESTE do champion (source_system=google_calendar, IDs fixos
// conferidos contra as respostas da API):
//   wgp613sypuq0evx = "Acompanhamento — Acuidar João Pessoa" (rodada showDeleted)
//   w2u1o9cjexqldp2 = "Consultoria | Unidade 2" (rodada showDeleted)
//   lhh6qipldg199tz = "Acompanhamento — Acuidar João Pessoa" CANCELADA (occurrence_type=cancelamento)
// Fixtures de teste, não registros operacionais; mesmo critério 0005/0006/0009/0010. Down vazio.

migrate(
  (app) => {
    for (const id of ['wgp613sypuq0evx', 'w2u1o9cjexqldp2', 'lhh6qipldg199tz']) {
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
