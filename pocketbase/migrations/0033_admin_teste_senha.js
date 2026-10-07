// 0033 — Redefinição de senha do usuário administrador admin-teste@acuidarbr.com.br
// 1. Senha: "AdaptaAdmin123!" via setPassword() para hashing correto pelo PocketBase
// 2. verified = true
// 3. role = "administrador"
// 4. empresas_autorizadas = ["acuidar", "donahelp"]

migrate(
  (app) => {
    try {
      const record = app.findAuthRecordByEmail('_pb_users_auth_', 'admin-teste@acuidarbr.com.br')
      record.setPassword('AdaptaAdmin123!')
      record.setVerified(true)
      record.set('role', 'administrador')
      record.set('empresas_autorizadas', ['acuidar', 'donahelp'])
      app.save(record)
      console.log('0033: Senha e dados de admin-teste@acuidarbr.com.br atualizados com sucesso.')
    } catch (err) {
      console.error('0033 erro ao atualizar admin-teste@acuidarbr.com.br:', err)
      throw err
    }
  },
  (app) => {
    // Down migration: não reverte senha pois senha anterior é desconhecida
  },
)
