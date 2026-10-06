// FAROL-1 (farol consolidado) — pontuacao_faturamento/pontuacao_contratos opcionais na collection
// Causa provada (API nativa, 2026-10-06): carga com pontuacao_faturamento=0 (unidades não
// ranqueadas) falha com "Cannot be blank" — number required rejeita 0 (AP-2026-10-06-1310).
// A obrigatoriedade continua no hook (avaliacoes_salvar) para o fluxo do formulário.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    for (const nome of ['pontuacao_faturamento', 'pontuacao_contratos']) {
      const f = col.fields.getByName(nome)
      if (f) {
        f.required = false
      }
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    for (const nome of ['pontuacao_faturamento', 'pontuacao_contratos']) {
      const f = col.fields.getByName(nome)
      if (f) {
        f.required = true
      }
    }
    app.save(col)
  },
)
