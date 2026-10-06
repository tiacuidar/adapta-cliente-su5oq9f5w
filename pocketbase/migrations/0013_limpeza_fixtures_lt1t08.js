// LT-1-T08 — Limpeza das 8 ocorrências "conferencia" criadas pela prova da decisão (B)
// (v0.0.42, 2026-10-06). Foram importadas da agenda de TESTE da automação
// (acuidar.automacao@gmail.com) pelo hook com a credencial GOOGLE_CALENDAR_TOKEN_DONAH —
// fixtures de teste, não registros operacionais; mesmo critério das migrations 0010/0011.
// IDs fixos conferidos contra a resposta da API. Down vazio por design.

migrate(
  (app) => {
    for (const id of [
      'bszbm7w963ditsc',
      'rflzxapqir03pcn',
      'zyczjncym2sk2kk',
      'bjr3gfsb9oqqsf9',
      'wple6elvt4rpdfh',
      'p8fa2ot1xywsefx',
      '4i4sys7f9akjqo6',
      'sq8tz37rnsvvoyr',
    ]) {
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
