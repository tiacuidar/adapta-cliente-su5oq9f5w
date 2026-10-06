// FAROL-1 (farol consolidado) — campos cliente_oculto e contagem_qualitativa em avaliacoes
// Decisões do champion (2026-10-06 13:42):
//   1. ADICIONAR campo cliente oculto (0-20) no formulário — presente nos PDFs: a contagem
//      qualitativa = soma das perguntas + cliente oculto (20 fixo nas amostras extraídas).
//   2. Carga 2026 com SOMA CONSOLIDADA — as respostas individuais q1..q20 não foram extraídas
//      com confiabilidade; a carga grava a contagem qualitativa consolidada do PDF em
//      contagem_qualitativa (o semáforo usa só resultado/ranqueada/mínimos — não usa q1..q20).
// Fórmula do resultado (hook avaliacoes_salvar):
//   base = contagem_qualitativa (se presente — carga histórica) || soma(q1..q20) + cliente_oculto
//   resultado_geral = base + pontuacao_faturamento + pontuacao_contratos
// Campos number com required rejeitam 0 (AP-2026-10-06-1310) — required:false + validação no hook.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    col.fields.add(
      new Field({
        name: 'cliente_oculto',
        type: 'number',
        required: false,
        min: 0,
        max: 20,
      }),
    )
    col.fields.add(
      new Field({
        name: 'contagem_qualitativa',
        type: 'number',
        required: false,
        min: 0,
      }),
    )
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    col.fields.removeByName('cliente_oculto')
    col.fields.removeByName('contagem_qualitativa')
    app.save(col)
  },
)
