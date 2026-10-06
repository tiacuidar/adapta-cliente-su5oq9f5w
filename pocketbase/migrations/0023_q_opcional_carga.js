// FAROL-1 (farol consolidado) — q1..q18 deixam de ser required na collection
// Causa provada (API nativa, 2026-10-06): gravação com contagem_qualitativa (carga histórica,
// decisão champion 13:42 — soma consolidada sem respostas individuais) falha com
// "q1..q18: Cannot be blank" — a 0018 só liberou q19/q20/pontuacao_contratos.
// A obrigatoriedade continua no hook (avaliacoes_salvar): sem contagem_qualitativa, q1..q20
// continuam exigidos; com contagem_qualitativa (carga), q1..q20 ficam 0.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    for (let i = 1; i <= 18; i++) {
      const f = col.fields.getByName('q' + i)
      if (f) {
        f.required = false
      }
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    for (let i = 1; i <= 18; i++) {
      const f = col.fields.getByName('q' + i)
      if (f) {
        f.required = true
      }
    }
    app.save(col)
  },
)
