// LT-1-T06 — Campo empresas_autorizadas nos usuários (RLS por empresa)
// Regra aprovada pelo Champion (2026-10-02T15:43Z):
//   consultoras veem só a(s) empresa(s) autorizada(s); gestores/admins veem ambas.
// SelectField múltiplo: acuidar | donahelp. Contas de teste preenchidas:
//   consultor-teste = acuidar · gestor-teste = ambas · admin-teste = ambas
//   + nova conta consultora-donahelp-teste (role consultor, só donahelp)
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('users')
    if (!col.fields.getByName('empresas_autorizadas')) {
      col.fields.add(
        new SelectField({
          name: 'empresas_autorizadas',
          values: ['acuidar', 'donahelp'],
          maxSelect: 2,
        }),
      )
    }
    app.save(col)

    // Preencher contas de teste existentes
    const preencher = (email, empresas) => {
      try {
        const rec = app.findAuthRecordByEmail('users', email)
        rec.set('empresas_autorizadas', empresas)
        app.save(rec)
      } catch (err) {
        // conta inexistente — segue
      }
    }
    preencher('consultor-teste@acuidarbr.com.br', ['acuidar'])
    preencher('gestor-teste@acuidarbr.com.br', ['acuidar', 'donahelp'])
    preencher('admin-teste@acuidarbr.com.br', ['acuidar', 'donahelp'])

    // Nova conta de teste: consultora Dona Help
    try {
      app.findAuthRecordByEmail('users', 'consultora-donahelp-teste@donahelpbr.com.br')
    } catch (err) {
      const col2 = app.findCollectionByNameOrId('users')
      const rec = new Record(col2)
      rec.set('email', 'consultora-donahelp-teste@donahelpbr.com.br')
      rec.set('password', 'TesteD!2026x')
      rec.set('verified', true)
      rec.set('name', 'Consultora Dona Help Teste')
      rec.set('role', 'consultor')
      rec.set('empresas_autorizadas', ['donahelp'])
      app.save(rec)
    }
  },
  (app) => {
    // Down: remover a conta de teste criada e o campo
    try {
      const rec = app.findAuthRecordByEmail('users', 'consultora-donahelp-teste@donahelpbr.com.br')
      app.delete(rec)
    } catch (err) {
      // já inexistente
    }
    const col = app.findCollectionByNameOrId('users')
    col.fields.removeByName('empresas_autorizadas')
    app.save(col)
  },
)
