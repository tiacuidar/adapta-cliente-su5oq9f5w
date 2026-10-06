// FAROL-1 (FA-2) — Correção: campos number com required rejeitam 0 no PocketBase
// (0 é tratado como vazio). q19/q20 (PEDHE usa 18 perguntas) e pontuacao_contratos
// (PEDHE = 0) precisam aceitar 0. A validação de obrigatoriedade fica no hook
// (avaliacoes_salvar), que já valida q1..q20 (PECAF) / q1..q18 (PEDHE) e as pontuações.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    for (const nome of ['q19', 'q20', 'pontuacao_contratos']) {
      const f = col.fields.getByName(nome)
      if (f) {
        f.required = false
      }
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    for (const nome of ['q19', 'q20', 'pontuacao_contratos']) {
      const f = col.fields.getByName(nome)
      if (f) {
        f.required = true
      }
    }
    app.save(col)
  },
)
