// FAROL-1 (farol consolidado) — garantia do campo contagem_qualitativa em avaliacoes
// Diagnóstico: a carga com contagem_qualitativa falha ao gravar ("Falha ao gravar") enquanto
// cliente_oculto grava ok — indicativo de que o campo contagem_qualitativa não existe na
// collection (a migration 0021 pode ter aplicado só o primeiro add). Migration idempotente:
// adiciona o campo somente se ausente (AP-2026-10-06-1310: number required rejeita 0 →
// required:false; a validação fica no hook).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('avaliacoes')
    let f = null
    try {
      f = col.fields.getByName('contagem_qualitativa')
    } catch (err) {
      f = null
    }
    if (!f) {
      col.fields.add(
        new Field({
          name: 'contagem_qualitativa',
          type: 'number',
          required: false,
          min: 0,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    // Down: não remove (o campo pode ter vindo da 0021)
  },
)
