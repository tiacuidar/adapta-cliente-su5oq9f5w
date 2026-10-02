// LT-1-T03 — Campos de trilha e multiempresa na collection ocorrencias
// criado_por: solicitante (aprovador ≠ solicitante — CA-1-07)
// aprovador_por: quem aprovou/rejeitou exceção (trilha auditável — ator)
// empresa: separação multiempresa aprovada pelo Champion (2026-09-30)
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ocorrencias')
    if (!col.fields.getByName('criado_por')) {
      col.fields.add(new TextField({ name: 'criado_por', max: 64 }))
    }
    if (!col.fields.getByName('aprovador_por')) {
      col.fields.add(new TextField({ name: 'aprovador_por', max: 64 }))
    }
    if (!col.fields.getByName('empresa')) {
      col.fields.add(
        new SelectField({
          name: 'empresa',
          values: ['acuidar', 'donahelp'],
          maxSelect: 1,
        }),
      )
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('ocorrencias')
    col.fields.removeByName('criado_por')
    col.fields.removeByName('aprovador_por')
    col.fields.removeByName('empresa')
    app.save(col)
  },
)
