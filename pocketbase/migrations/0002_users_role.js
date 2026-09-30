// F1-T04 — Campo role nos usuários (matriz de perfis aprovada pelo Champion)
// Perfis: consultor | gestor | administrador
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('users')
    if (!col.fields.getByName('role')) {
      col.fields.add(
        new SelectField({
          name: 'role',
          values: ['consultor', 'gestor', 'administrador'],
          maxSelect: 1,
        }),
      )
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('users')
    col.fields.removeByName('role')
    app.save(col)
  },
)
